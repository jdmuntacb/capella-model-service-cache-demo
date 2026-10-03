import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createMockGateway } from "../packages/mock-gateway/src/server.js";
import { GatewayClient, GatewayError, SYSTEM_PROMPT, listModels } from "../packages/core/src/index.js";
import { explain } from "../apps/web/components/explain.js";

const MODEL = "amazon.nova-lite-v1:0";
const KEY = "cbsk-v1-secret-test-key-1234";
const gw = createMockGateway({
  models: [MODEL],
  latency: { ttftMs: 20, perTokenMs: 0.2, jitter: 0 },
  lookupMs: { standard: 1, semantic: 1 },
});
let endpoint: string;
let client: GatewayClient;

beforeAll(async () => {
  await new Promise<void>((r) => gw.server.listen(0, r));
  endpoint = `http://localhost:${(gw.server.address() as AddressInfo).port}`;
  client = new GatewayClient({ endpoint, apiKey: KEY, model: MODEL, debug: true });
});
afterAll(() => gw.server.close());

const ask = (q: string) => [
  { role: "system" as const, content: SYSTEM_PROMPT },
  { role: "user" as const, content: q },
];

describe("request traces", () => {
  it("records the exchange with the API key masked", async () => {
    const r = await client.chat(ask("How do I set up MFA?"), { mode: "standard", trace: true, topic: "c1" });
    const t = r.trace!;
    expect(t.request.url).toBe(`${endpoint}/v1/chat/completions`);
    expect(t.request.headers.Authorization).toBe("Bearer ****1234");
    expect(JSON.stringify(t)).not.toContain(KEY);
    expect(t.request.headers["X-cb-cache"]).toBe("standard");
    expect(t.request.headers["X-cb-attr-topic"]).toBe("c1");
    expect(t.response?.status).toBe(200);
    expect(t.response?.headers["x-cb-cache-enabled"]).toBe("true");
    expect((t.response?.body as { usage: unknown }).usage).toEqual(r.usage);
  });

  it("omits the trace unless asked", async () => {
    const r = await client.chat(ask("How do I set up MFA?"), { mode: "none" });
    expect(r.trace).toBeUndefined();
  });

  it("attaches a trace to gateway errors", async () => {
    const bad = new GatewayClient({ endpoint, apiKey: KEY, model: "no-such-model", debug: true });
    const err = await bad.chat(ask("hi"), { mode: "standard", trace: true }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.trace.response.status).toBe(404);
    expect(explain({ mode: "standard", cacheHit: false, promptTokens: 0, completionTokens: 0, latencyMs: 1, scoped: false, trace: err.trace, error: err.message }).tone).toBe("error");
  });

  it("reports unreachable gateways as a network error", async () => {
    const down = new GatewayClient({ endpoint: "http://127.0.0.1:1", apiKey: KEY, model: MODEL });
    const err = await down.chat(ask("hi"), { mode: "none", trace: true }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.trace.networkError).toBeTruthy();
  });

  it("lists models", async () => {
    expect(await listModels(endpoint, KEY)).toEqual([
      { id: MODEL, name: MODEL },
      { id: "mock-lexical-embedding", name: "mock-lexical-embedding" },
    ]);
  });
});

describe("explanations", () => {
  const base = { promptTokens: 100, completionTokens: 50, latencyMs: 20, scoped: false };

  it("explains a miss then an exact hit", async () => {
    const q = ask("Where do I submit expenses?");
    const miss = await client.chat(q, { mode: "semantic", trace: true });
    const hit = await client.chat(q, { mode: "semantic", trace: true });
    expect(explain({ ...base, ...miss, trace: miss.trace }).verdict).toBe("Cache miss: answered by Bedrock");
    expect(explain({ ...base, ...hit, trace: hit.trace }).verdict).toBe("Cache hit: exact match");
  });

  it("explains a similar-question hit with score and threshold", async () => {
    await client.chat(ask("How do I reset my password?"), { mode: "semantic" });
    const hit = await client.chat(ask("I forgot my password, how can I reset it?"), { mode: "semantic", trace: true });
    expect(hit.cacheHit).toBe(true);
    const ex = explain({ ...base, ...hit, trace: hit.trace });
    expect(ex.verdict).toBe("Cache hit: similar question");
    expect(ex.steps.join(" ")).toMatch(/scored 0\.\d{3}, above the 0\.75 threshold/);
  });

  it("flags a gateway that has caching disabled", () => {
    const trace = {
      request: { method: "POST", url: "https://x/v1/chat/completions", headers: {}, body: {} },
      response: { status: 200, headers: { "x-cb-cache-enabled": "false", "x-cb-semantic-cache-embedding-model": "" }, body: {} },
      latencyMs: 900,
    };
    const ex = explain({ ...base, mode: "semantic", cacheHit: false, trace });
    expect(ex.tone).toBe("off");
    expect(ex.steps.join(" ")).toContain("No embedding model is attached");
  });

  it("warns when a repeated question still misses", () => {
    const trace = {
      request: { method: "POST", url: "https://x/v1/chat/completions", headers: {}, body: {} },
      response: { status: 200, headers: { "x-cb-cache-enabled": "true", "x-cb-cache-expiry": "1h0m0s" }, body: {} },
      latencyMs: 900,
    };
    const ex = explain({ ...base, mode: "standard", cacheHit: false, trace, repeatMiss: true });
    expect(ex.tone).toBe("miss");
    expect(ex.steps.join(" ")).toContain("cache write is failing");
  });
});

describe("gateway info (/v1/info)", () => {
  it("normalizes the gateway's info body", async () => {
    const { parseInfo } = await import("../packages/core/src/index.js");
    const info = parseInfo({
      version: "1.2.0-5",
      commit_hash: "fe334d2",
      build_time: "2026-09-15T00:14:54-0700",
      max_requests_per_minute: 10000,
      defaults: { default_cache_expiry_duration: 3600000000000, max_cache_expiry_duration: 604800000000000, max_tokens: 512, temperature: 0.8 },
      models: [{ id: "amazon.nova-lite-v1:0::abc", model_name: "amazon.nova-lite-v1:0", server_kind: "bedrock", status: "healthy", server_reachable: true }],
    });
    expect(info.version).toBe("1.2.0-5");
    expect(info.defaults.cacheExpirySeconds).toBe(3600);
    expect(info.defaults.maxCacheExpirySeconds).toBe(604800);
    expect(info.models).toEqual([{ id: "amazon.nova-lite-v1:0::abc", name: "amazon.nova-lite-v1:0", serverKind: "bedrock", status: "healthy", reachable: true }]);
  });

  it("reads /v1/info from the mock gateway", async () => {
    const { getInfo } = await import("../packages/core/src/index.js");
    const info = await getInfo(endpoint, KEY);
    expect(info?.version).toBe("mock");
    expect(info?.models.map((m) => m.name)).toContain(MODEL);
    expect(info?.defaults.cacheExpirySeconds).toBe(3600);
  });

  it("returns null when the gateway has no info endpoint", async () => {
    const { getInfo } = await import("../packages/core/src/index.js");
    const { createServer } = await import("node:http");
    const bare = createServer((_, res) => res.writeHead(404).end());
    await new Promise<void>((r) => bare.listen(0, r));
    const url = `http://localhost:${(bare.address() as AddressInfo).port}`;
    expect(await getInfo(url, KEY)).toBeNull();
    bare.close();
  });
});
