// Mock Capella Model Service (AI Gateway): OpenAI-compatible /v1/chat/completions with
// the same cache headers as the real gateway, so the demo runs with no Capella access.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { HEADERS } from "@demo/core";
import { GatewayCache, type CacheContext, type ChatRequestBody } from "./cache";
import { denseEmbed, tokenize } from "./embed";
import { complete, DEFAULT_LATENCY, type LatencyProfile } from "./llm";

export interface MockOptions {
  /** Cache type when no X-cb-cache header is sent. */
  defaultCacheType?: "none" | "standard" | "semantic";
  /** Semantic similarity threshold (scoreThreshold). */
  scoreThreshold?: number;
  /** Cache expiry in seconds. */
  expirySeconds?: number;
  latency?: LatencyProfile;
  /** Simulated cache lookup cost in ms: KV get, and embedding + vector search. */
  lookupMs?: { standard: number; semantic: number };
  models?: string[];
}

interface StoredResponse {
  body: Record<string, unknown>;
}

export interface MockStats {
  requests: number;
  upstreamCalls: number;
  standardHits: number;
  semanticHits: number;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  cachedCompletionTokens: number;
  cacheEntries: number;
}

/** The mock's embedding model, served on /v1/embeddings and listed in /v1/models. */
export const MOCK_EMBEDDING_MODEL = "mock-lexical-embedding";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export function createMockGateway(opts: MockOptions = {}): { server: Server; stats: () => MockStats; reset: () => void } {
  const defaultCacheType = opts.defaultCacheType ?? "none";
  const scoreThreshold = opts.scoreThreshold ?? 0.75;
  const expirySeconds = opts.expirySeconds ?? 3600;
  const latency = opts.latency ?? DEFAULT_LATENCY;
  const lookupMs = opts.lookupMs ?? { standard: 15, semantic: 45 };
  const models = opts.models ?? ["anthropic.claude-sonnet-5-5"];
  const cache = new GatewayCache<StoredResponse>();
  const counters = {
    requests: 0,
    upstreamCalls: 0,
    standardHits: 0,
    semanticHits: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    cachedCompletionTokens: 0,
  };

  const json = (res: ServerResponse, status: number, payload: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  const readBody = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  };

  async function chatCompletions(req: IncomingMessage, res: ServerResponse) {
    const auth = req.headers.authorization ?? "";
    const apiKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!apiKey) return json(res, 401, { error: { message: "missing bearer token" } });

    let body: ChatRequestBody;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: { message: "invalid JSON body" } });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json(res, 400, { error: { message: "messages is required" } });
    }
    if (body.stream) return json(res, 400, { error: { message: "the mock gateway does not stream" } });
    if (!models.includes(body.model)) {
      return json(res, 404, { error: { message: `model ${body.model} not found` } });
    }
    counters.requests++;

    // Request headers, parsed like ai-gateway pkg/handlers/types/metadata.go.
    const header = (name: string) => {
      const v = req.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };
    let mode = defaultCacheType;
    const requested = header(HEADERS.cacheType)?.trim().toLowerCase();
    if (requested === "none" || requested === "standard" || requested === "semantic") mode = requested;
    let threshold = scoreThreshold;
    const thr = Number(header(HEADERS.cacheThreshold));
    if (header(HEADERS.cacheThreshold) && Number.isFinite(thr)) threshold = thr;
    let ttl = expirySeconds;
    const exp = Number(header(HEADERS.cacheExpiryDuration));
    if (header(HEADERS.cacheExpiryDuration) && exp > 0) ttl = exp;
    const debug = header(HEADERS.debug) === "true";

    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.startsWith(HEADERS.attributePrefix.toLowerCase()) && v !== undefined) {
        attributes[k.slice(HEADERS.attributePrefix.length)] = Array.isArray(v) ? v[0] : v;
      }
    }
    const ctx: CacheContext = {
      attributes,
      identity: createHash("sha256").update(apiKey).digest("hex").slice(0, 16),
    };

    if (debug) {
      res.setHeader(HEADERS.cacheTypeUsed, mode);
      res.setHeader(HEADERS.cacheEnabled, String(mode !== "none"));
      res.setHeader("X-cb-cache-expiry", `${ttl}s`);
      res.setHeader("X-cb-semantic-cache-match-threshold", String(mode === "standard" ? 1 : threshold));
      res.setHeader("X-cb-semantic-cache-embedding-model", mode === "semantic" ? "mock-lexical-embedding" : "");
    }

    if (mode !== "none") {
      await sleep(mode === "semantic" ? lookupMs.semantic : lookupMs.standard);
      const hit = cache.lookup(body, ctx, mode, threshold);
      if (hit) {
        if (hit.kind === "semantic") counters.semanticHits++;
        else counters.standardHits++;
        const usage = hit.value.body.usage as { prompt_tokens: number; completion_tokens: number };
        counters.cachedPromptTokens += usage.prompt_tokens;
        counters.cachedCompletionTokens += usage.completion_tokens;
        res.setHeader(HEADERS.cacheHit, "HIT");
        if (debug) res.setHeader(HEADERS.matchScore, String(Number(hit.score.toFixed(4))));
        cache.store(body, ctx, hit.value, ttl);
        // The stored response is returned as-is, including its original usage.
        return json(res, 200, hit.value.body);
      }
      // On a miss the real gateway usually sends no X-Cache header at all.
    }

    counters.upstreamCalls++;
    const c = complete(body, latency);
    await sleep(c.latencyMs);
    counters.promptTokens += c.promptTokens;
    counters.completionTokens += c.completionTokens;
    const payload = {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: c.content }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: c.promptTokens,
        completion_tokens: c.completionTokens,
        total_tokens: c.promptTokens + c.completionTokens,
      },
    };
    if (mode !== "none") cache.store(body, ctx, { body: payload }, ttl);
    return json(res, 200, payload);
  }

  // Like the real gateway, embeddings are never cached: every call goes to the (simulated) model.
  async function embeddings(req: IncomingMessage, res: ServerResponse) {
    if (!(req.headers.authorization ?? "").startsWith("Bearer ")) return json(res, 401, { error: { message: "missing bearer token" } });
    let body: { model?: string; input?: string | string[] };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: { message: "invalid JSON body" } });
    }
    if (body.model !== MOCK_EMBEDDING_MODEL) return json(res, 404, { error: { message: `model ${body.model} not found` } });
    const inputs = (Array.isArray(body.input) ? body.input : [body.input]).filter((x): x is string => typeof x === "string" && x.length > 0);
    if (!inputs.length) return json(res, 400, { error: { message: "input is required" } });
    counters.requests++;
    counters.upstreamCalls++;
    await sleep(40 + Math.random() * 40);
    const tokens = inputs.reduce((a, t) => a + Math.max(1, Math.ceil(t.split(/\s+/).length * 1.3)), 0);
    counters.promptTokens += tokens;
    return json(res, 200, {
      object: "list",
      model: MOCK_EMBEDDING_MODEL,
      data: inputs.map((t, index) => ({ object: "embedding", index, embedding: denseEmbed(tokenize(t)) })),
      usage: { prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens },
    });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = `${req.method} ${url.pathname}`;
    const done = (p: Promise<void> | void) =>
      Promise.resolve(p).catch((err) => json(res, 500, { error: { message: String(err) } }));
    switch (route) {
      case "POST /v1/chat/completions":
        return done(chatCompletions(req, res));
      case "POST /v1/embeddings":
        return done(embeddings(req, res));
      case "GET /v1/info":
      case "GET /info":
        // Same shape as the gateway's /v1/info; durations are Go nanoseconds.
        return json(res, 200, {
          version: "mock",
          commit_hash: "",
          build_time: "",
          max_requests_per_minute: 0,
          defaults: { default_cache_expiry_duration: expirySeconds * 1e9, max_tokens: 512, temperature: 0.8 },
          models: [
            ...models.map((id) => ({ id, model_name: id, server_kind: "mock", status: "healthy", server_reachable: true, info: null })),
            { id: MOCK_EMBEDDING_MODEL, model_name: MOCK_EMBEDDING_MODEL, server_kind: "mock", status: "healthy", server_reachable: true, info: null },
          ],
        });
      case "GET /v1/models":
        return json(res, 200, { object: "list", data: [...models, MOCK_EMBEDDING_MODEL].map((id) => ({ id, object: "model", owned_by: "mock" })) });
      case "GET /health":
        return json(res, 200, { status: "ok", mock: true });
      case "GET /mock/stats":
        return json(res, 200, { ...counters, cacheEntries: cache.size });
      case "POST /mock/reset":
        cache.clear();
        for (const k of Object.keys(counters) as (keyof typeof counters)[]) counters[k] = 0;
        return json(res, 200, { status: "reset" });
      default:
        return json(res, 404, { error: { message: `no route ${route}` } });
    }
  });

  return {
    server,
    stats: () => ({ ...counters, cacheEntries: cache.size }),
    reset: () => cache.clear(),
  };
}
