import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { MOCK_EMBEDDING_MODEL, createMockGateway } from "../packages/mock-gateway/src/server.js";
import { GatewayClient, GatewayError, cosineSimilarity, isEmbeddingModel, summarizeEmbeddings } from "../packages/core/src/index.js";
import { explain } from "../apps/web/components/explain.js";

const KEY = "cbsk-v1-secret-test-key-1234";
const gw = createMockGateway({ models: ["amazon.nova-lite-v1:0"] });
let endpoint: string;
let client: GatewayClient;

beforeAll(async () => {
  await new Promise<void>((r) => gw.server.listen(0, r));
  endpoint = `http://localhost:${(gw.server.address() as AddressInfo).port}`;
  client = new GatewayClient({ endpoint, apiKey: KEY, model: MOCK_EMBEDDING_MODEL, debug: true });
});
afterAll(() => gw.server.close());

describe("embeddings (/v1/embeddings)", () => {
  it("tells embedding models from chat models", () => {
    expect(isEmbeddingModel("amazon.titan-embed-text-v2:0")).toBe(true);
    expect(isEmbeddingModel(MOCK_EMBEDDING_MODEL)).toBe(true);
    expect(isEmbeddingModel("amazon.nova-lite-v1:0")).toBe(false);
  });

  it("returns the vector and usage, sends no cache header, and keeps the trace small", async () => {
    const r = await client.embed("How do I reset my VPN password?", { trace: true });
    expect(r.dimensions).toBe(256);
    expect(r.embedding).toHaveLength(256);
    expect(r.usage.prompt_tokens).toBeGreaterThan(0);
    expect(r.trace?.request.url).toBe(`${endpoint}/v1/embeddings`);
    expect(r.trace?.request.body).toEqual({ model: MOCK_EMBEDDING_MODEL, input: "How do I reset my VPN password?" });
    expect(Object.keys(r.trace?.request.headers ?? {})).not.toContain("X-cb-cache");
    expect(r.trace?.request.headers.Authorization).toBe("Bearer ****1234");
    const traced = (r.trace?.response?.body as { data: { embedding: unknown[] }[] }).data[0].embedding;
    expect(traced).toHaveLength(9);
    expect(traced[8]).toBe("... 248 more values (256 dimensions)");
  });

  it("scores paraphrases above unrelated questions", async () => {
    const [a, b, c] = await Promise.all(
      ["How many vacation days do I get?", "How much annual leave do I get each year?", "How do I connect to the VPN?"].map((q) => client.embed(q)),
    );
    expect(cosineSimilarity(a.embedding, a.embedding)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(a.embedding, b.embedding)).toBeGreaterThan(cosineSimilarity(a.embedding, c.embedding));
  });

  it("returns 404 with a trace for a chat model on /v1/embeddings", async () => {
    const chat = new GatewayClient({ endpoint, apiKey: KEY, model: "amazon.nova-lite-v1:0" });
    const err = await chat.embed("hello", { trace: true }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.status).toBe(404);
    expect(err.trace.response.status).toBe(404);
  });

  it("explains that embeddings are not cached", () => {
    const ex = explain({
      mode: "none",
      cacheHit: false,
      promptTokens: 9,
      completionTokens: 0,
      latencyMs: 120,
      scoped: false,
      embedding: { model: "amazon.titan-embed-text-v2:0", dimensions: 1024, nearest: [{ question: "VPN reset?", score: 0.8123 }] },
    });
    expect(ex.verdict).toBe("Embedding: not cached");
    expect(ex.steps.join(" ")).toContain("1,024-dimension vector");
    expect(ex.steps.join(" ")).toContain("does not cache embeddings");
    expect(ex.steps.at(-1)).toContain("0.812");
  });

  it("leaves short or non-embedding bodies alone", () => {
    expect(summarizeEmbeddings({ error: "x" })).toEqual({ error: "x" });
    expect(summarizeEmbeddings({ data: [{ embedding: [1, 2] }] })).toEqual({ data: [{ embedding: [1, 2] }] });
  });
});
