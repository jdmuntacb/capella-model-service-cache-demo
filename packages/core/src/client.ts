import { HEADERS, type CacheMode } from "./headers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatOptions {
  mode: CacheMode;
  /** Scopes the cache to a conversation via X-cb-attr-topic. */
  topic?: string;
  /** Overrides the semantic similarity threshold for this request. */
  threshold?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Record the raw HTTP exchange (API key masked) on the result. */
  trace?: boolean;
}

/** One request/response exchange with the gateway, safe to show in a UI. */
export interface Trace {
  request: {
    method: string;
    url: string;
    /** Authorization is masked. */
    headers: Record<string, string>;
    body: unknown;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
  /** Set when the gateway could not be reached. */
  networkError?: string;
  latencyMs: number;
}

export interface ChatResult {
  content: string;
  usage: Usage;
  cacheHit: boolean;
  /** Similarity score reported on semantic hits (debug mode only). */
  matchScore?: number;
  latencyMs: number;
  mode: CacheMode;
  model: string;
  /** A miss means the gateway called the upstream model (Bedrock). */
  upstreamCalled: boolean;
  trace?: Trace;
}

export interface GatewayConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  debug?: boolean;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly trace?: Trace,
  ) {
    super(message);
  }
}

export interface EmbedOptions {
  signal?: AbortSignal;
  trace?: boolean;
}

export interface EmbedResult {
  embedding: number[];
  dimensions: number;
  usage: Usage;
  latencyMs: number;
  model: string;
  trace?: Trace;
}

/** Embedding models are named like amazon.titan-embed-text-v2:0; Capella lists no model type. */
export const isEmbeddingModel = (name: string) => /embed/i.test(name);

/** Cosine similarity of two dense vectors (0 when either is empty or the lengths differ). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const usageOf = (u?: Partial<Usage>): Usage => ({
  prompt_tokens: u?.prompt_tokens ?? 0,
  completion_tokens: u?.completion_tokens ?? 0,
  total_tokens: u?.total_tokens ?? (u?.prompt_tokens ?? 0) + (u?.completion_tokens ?? 0),
});

export class GatewayClient {
  constructor(private readonly cfg: GatewayConfig) {}

  get model(): string {
    return this.cfg.model;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const headers: Record<string, string> = { [HEADERS.cacheType]: opts.mode };
    if (opts.topic) headers[`${HEADERS.attributePrefix}topic`] = opts.topic;
    if (opts.threshold !== undefined) headers[HEADERS.cacheThreshold] = String(opts.threshold);

    const body = {
      model: this.cfg.model,
      messages,
      max_tokens: opts.maxTokens ?? 512,
      stream: false,
    };
    const { res, text, latencyMs, trace } = await this.post("/v1/chat/completions", headers, body, opts);

    const json = JSON.parse(text) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: Partial<Usage>;
    };
    const cacheHit = res.headers.get(HEADERS.cacheHit)?.toUpperCase() === "HIT";
    const score = res.headers.get(HEADERS.matchScore);

    return {
      content: json.choices?.[0]?.message?.content ?? "",
      usage: usageOf(json.usage),
      cacheHit,
      matchScore: score ? Number(score) : undefined,
      latencyMs,
      mode: opts.mode,
      model: json.model ?? this.cfg.model,
      upstreamCalled: !cacheHit,
      trace,
    };
  }

  /** POST /v1/embeddings. The gateway does not cache embeddings, so no cache headers are sent. */
  async embed(input: string, opts: EmbedOptions = {}): Promise<EmbedResult> {
    const body = { model: this.cfg.model, input };
    const { text, latencyMs, trace } = await this.post("/v1/embeddings", {}, body, opts);
    const json = JSON.parse(text) as { model?: string; data?: { embedding?: number[] }[]; usage?: Partial<Usage> };
    const embedding = json.data?.[0]?.embedding ?? [];
    // A 1024-value vector would swamp the trace view; keep a preview there.
    if (trace?.response) trace.response.body = summarizeEmbeddings(trace.response.body);
    return { embedding, dimensions: embedding.length, usage: usageOf(json.usage), latencyMs, model: json.model ?? this.cfg.model, trace };
  }

  private async post(path: string, extra: Record<string, string>, body: unknown, opts: { signal?: AbortSignal; trace?: boolean }) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.cfg.apiKey}`,
      ...extra,
    };
    if (this.cfg.debug) headers[HEADERS.debug] = "true";
    const url = `${this.cfg.endpoint.replace(/\/+$/, "")}${path}`;
    const trace: Trace | undefined = opts.trace
      ? { request: { method: "POST", url, headers: maskHeaders(headers), body }, latencyMs: 0 }
      : undefined;
    const started = performance.now();
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      text = await res.text();
    } catch (err) {
      if (trace) {
        trace.latencyMs = performance.now() - started;
        trace.networkError = errorMessage(err);
      }
      throw new GatewayError(`Could not reach the gateway: ${errorMessage(err)}`, 0, "", trace);
    }
    const latencyMs = performance.now() - started;
    if (trace) {
      trace.latencyMs = latencyMs;
      trace.response = { status: res.status, headers: responseHeaders(res), body: parseBody(text) };
    }

    if (!res.ok) {
      throw new GatewayError(`Gateway returned ${res.status}`, res.status, text.slice(0, 500), trace);
    }
    return { res, text, latencyMs, trace };
  }
}

const PREVIEW_VALUES = 8;

/** Replaces each embedding array in a response body with its first values and a count of the rest. */
export function summarizeEmbeddings(body: unknown): unknown {
  if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) return body;
  const b = body as { data: Record<string, unknown>[] };
  return {
    ...b,
    data: b.data.map((d) => {
      const e = d.embedding;
      if (!Array.isArray(e) || e.length <= PREVIEW_VALUES) return d;
      return { ...d, embedding: [...e.slice(0, PREVIEW_VALUES), `... ${e.length - PREVIEW_VALUES} more values (${e.length} dimensions)`] };
    }),
  };
}

/** Shows only the last 4 characters of the bearer token. */
export function maskSecret(secret: string): string {
  return secret.length > 8 ? `****${secret.slice(-4)}` : "****";
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out = { ...headers };
  if (out.Authorization) out.Authorization = `Bearer ${maskSecret(out.Authorization.replace(/^Bearer\s+/i, ""))}`;
  return out;
}

function responseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (k !== "set-cookie") out[k] = v;
  });
  return out;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

function errorMessage(err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return (err instanceof Error ? err.message : String(err)) + cause;
}

export interface ModelInfo {
  id: string;
  name: string;
}

/** Lists the models the gateway serves (GET /v1/models). */
export async function listModels(endpoint: string, apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const res = await fetch(`${endpoint.replace(/\/+$/, "")}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new GatewayError(`Gateway returned ${res.status}`, res.status, text.slice(0, 500));
  const json = JSON.parse(text) as { data?: { id: string; model_name?: string }[] };
  // Capella lists "<model>::<deployment id>" as the id and the plain name as model_name.
  return (json.data ?? []).map((m) => ({ id: m.id, name: m.model_name ?? m.id }));
}

/** Builds a client from CMS_* env vars, pointing at the mock gateway when USE_MOCK=true. */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): GatewayClient {
  const useMock = (env.USE_MOCK ?? "true").toLowerCase() === "true";
  const endpoint = useMock ? `http://localhost:${env.MOCK_PORT ?? "8787"}` : env.CMS_ENDPOINT;
  const apiKey = useMock ? "mock-key" : env.CMS_API_KEY;
  if (!endpoint || !apiKey) {
    throw new Error("Set CMS_ENDPOINT and CMS_API_KEY in .env, or USE_MOCK=true");
  }
  return new GatewayClient({
    endpoint,
    apiKey,
    model: env.CMS_MODEL ?? "anthropic.claude-sonnet-5-5",
    debug: (env.CMS_DEBUG ?? "true").toLowerCase() === "true",
  });
}

export function isMock(env: Record<string, string | undefined> = process.env): boolean {
  return (env.USE_MOCK ?? "true").toLowerCase() === "true";
}

/** What GET /v1/info reports: gateway build and the models it serves. */
export interface GatewayInfo {
  version: string;
  commitHash?: string;
  buildTime?: string;
  models: {
    id: string;
    name: string;
    serverKind?: string;
    status?: string;
    reachable?: boolean;
  }[];
  defaults: {
    cacheExpirySeconds?: number;
    maxCacheExpirySeconds?: number;
    maxTokens?: number;
    temperature?: number;
  };
  maxRequestsPerMinute?: number;
}

interface RawInfo {
  version?: string;
  commit_hash?: string;
  build_time?: string;
  max_requests_per_minute?: number;
  defaults?: Record<string, number | undefined>;
  models?: { id: string; model_name?: string; server_kind?: string; status?: string; server_reachable?: boolean }[];
}

// Go durations are serialized as nanoseconds.
const nsToSeconds = (ns?: number) => (typeof ns === "number" ? ns / 1e9 : undefined);

/** Normalizes a GET /v1/info body. */
export function parseInfo(raw: RawInfo): GatewayInfo {
  const d = raw.defaults ?? {};
  return {
    version: raw.version ?? "unknown",
    commitHash: raw.commit_hash,
    buildTime: raw.build_time,
    models: (raw.models ?? []).map((m) => ({
      id: m.id,
      name: m.model_name ?? m.id,
      serverKind: m.server_kind,
      status: m.status,
      reachable: m.server_reachable,
    })),
    defaults: {
      cacheExpirySeconds: nsToSeconds(d.default_cache_expiry_duration),
      maxCacheExpirySeconds: nsToSeconds(d.max_cache_expiry_duration),
      maxTokens: d.max_tokens,
      temperature: d.temperature,
    },
    maxRequestsPerMinute: raw.max_requests_per_minute,
  };
}

/** Gateway version and models (GET /v1/info). Returns null if the gateway has no info endpoint. */
export async function getInfo(endpoint: string, apiKey: string, signal?: AbortSignal): Promise<GatewayInfo | null> {
  const res = await fetch(`${endpoint.replace(/\/+$/, "")}/v1/info`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) throw new GatewayError(`Gateway returned ${res.status}`, res.status, text.slice(0, 500));
  return parseInfo(JSON.parse(text) as RawInfo);
}
