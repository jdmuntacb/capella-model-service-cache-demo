import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createMockGateway } from "../packages/mock-gateway/src/server.js";
import { GatewayClient, SYSTEM_PROMPT } from "../packages/core/src/index.js";

const MODEL = "anthropic.claude-sonnet-5-5";
const gw = createMockGateway({
  models: [MODEL],
  latency: { ttftMs: 30, perTokenMs: 0.5, jitter: 0 },
  lookupMs: { standard: 1, semantic: 2 },
});
let client: GatewayClient;
let endpoint: string;

beforeAll(async () => {
  await new Promise<void>((r) => gw.server.listen(0, r));
  endpoint = `http://localhost:${(gw.server.address() as AddressInfo).port}`;
  client = new GatewayClient({ endpoint, apiKey: "test-key", model: MODEL, debug: true });
});
afterAll(() => gw.server.close());

const ask = (q: string) => [
  { role: "system" as const, content: SYSTEM_PROMPT },
  { role: "user" as const, content: q },
];

describe("mock gateway over HTTP", () => {
  it("never caches with X-cb-cache: none", async () => {
    const a = await client.chat(ask("How do I connect to the VPN?"), { mode: "none" });
    const b = await client.chat(ask("How do I connect to the VPN?"), { mode: "none" });
    expect(a.cacheHit || b.cacheHit).toBe(false);
  });

  it("returns X-Cache: HIT with the original usage on a standard repeat", async () => {
    const miss = await client.chat(ask("Where can I find my payslip?"), { mode: "standard" });
    const hit = await client.chat(ask("Where can I find my payslip?"), { mode: "standard" });
    expect(miss.cacheHit).toBe(false);
    expect(hit.cacheHit).toBe(true);
    expect(hit.matchScore).toBe(1);
    expect(hit.usage).toEqual(miss.usage);
    expect(hit.content).toBe(miss.content);
    expect(hit.latencyMs).toBeLessThan(miss.latencyMs);
  });

  it("sends no X-Cache header on a miss", async () => {
    const res = await fetch(`${endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer test-key", "Content-Type": "application/json", "X-cb-cache": "standard" },
      body: JSON.stringify({ model: MODEL, messages: ask("A question never asked before?") }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBeNull();
  });

  it("serves a paraphrase from the semantic cache", async () => {
    await client.chat(ask("How do I submit an expense report?"), { mode: "semantic" });
    const hit = await client.chat(ask("How can I get reimbursed for a business expense?"), { mode: "semantic" });
    expect(hit.cacheHit).toBe(true);
    expect(hit.matchScore).toBeGreaterThanOrEqual(0.75);
  });

  it("isolates conversations scoped with X-cb-attr-topic", async () => {
    await client.chat(ask("How do I install software on my laptop?"), { mode: "standard", topic: "conv-a" });
    const other = await client.chat(ask("How do I install software on my laptop?"), { mode: "standard", topic: "conv-b" });
    const same = await client.chat(ask("How do I install software on my laptop?"), { mode: "standard", topic: "conv-a" });
    expect(other.cacheHit).toBe(false);
    expect(same.cacheHit).toBe(true);
  });

  it("rejects requests without an API key", async () => {
    const res = await fetch(`${endpoint}/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("counts upstream calls and cached tokens", () => {
    const s = gw.stats();
    expect(s.upstreamCalls).toBeLessThan(s.requests);
    expect(s.cachedCompletionTokens).toBeGreaterThan(0);
  });
});
