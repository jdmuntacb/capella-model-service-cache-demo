import { describe, expect, it } from "vitest";
import { GatewayCache, type CacheContext } from "../packages/mock-gateway/src/cache.js";
import { TOPICS } from "../packages/core/src/helpdesk.js";
import { embed, similarity } from "../packages/mock-gateway/src/embed.js";

const ctx: CacheContext = { attributes: {}, identity: "key-1" };
const req = (q: string, extra: Record<string, unknown> = {}, system = "sys") => ({
  model: "m",
  max_tokens: 512,
  messages: [
    { role: "system", content: system },
    { role: "user", content: q },
  ],
  ...extra,
});

describe("standard cache", () => {
  it("hits only on an identical request", () => {
    const c = new GatewayCache<string>();
    c.store(req("How do I reset my password?"), ctx, "answer", 60);
    expect(c.lookup(req("How do I reset my password?"), ctx, "standard", 0.75)?.value).toBe("answer");
    expect(c.lookup(req("How do I reset my password ?"), ctx, "standard", 0.75)).toBeUndefined();
    expect(c.lookup(req("How do I reset my password?", { max_tokens: 256 }), ctx, "standard", 0.75)).toBeUndefined();
  });

  it("ignores the stream flag, like the gateway", () => {
    const c = new GatewayCache<string>();
    c.store(req("q", { stream: true }), ctx, "a", 60);
    expect(c.lookup(req("q"), ctx, "standard", 0.75)?.value).toBe("a");
  });

  it("is partitioned by caller identity, topic attribute and system prompt", () => {
    const c = new GatewayCache<string>();
    c.store(req("q"), ctx, "a", 60);
    expect(c.lookup(req("q"), { ...ctx, identity: "key-2" }, "standard", 0.75)).toBeUndefined();
    expect(c.lookup(req("q"), { ...ctx, attributes: { topic: "conv-9" } }, "standard", 0.75)).toBeUndefined();
    expect(c.lookup(req("q", {}, "sys v2"), ctx, "semantic", 0.0)).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    let now = 0;
    const c = new GatewayCache<string>(() => now);
    c.store(req("q"), ctx, "a", 10);
    now = 9_000;
    expect(c.lookup(req("q"), ctx, "standard", 0.75)).toBeDefined();
    now = 10_000;
    expect(c.lookup(req("q"), ctx, "standard", 0.75)).toBeUndefined();
  });
});

describe("semantic cache", () => {
  it("matches a paraphrase above the threshold and reports its score", () => {
    const c = new GatewayCache<string>();
    c.store(req("How do I request PTO?"), ctx, "pto-answer", 60);
    const hit = c.lookup(req("How do I book annual leave?"), ctx, "semantic", 0.75);
    expect(hit?.value).toBe("pto-answer");
    expect(hit?.kind).toBe("semantic");
    expect(hit!.score).toBeGreaterThanOrEqual(0.75);
  });

  it("does not match a different intent", () => {
    const c = new GatewayCache<string>();
    c.store(req("How do I request PTO?"), ctx, "pto-answer", 60);
    expect(c.lookup(req("How do I request a new laptop?"), ctx, "semantic", 0.75)).toBeUndefined();
  });

  it("standard mode never does similarity matching", () => {
    const c = new GatewayCache<string>();
    c.store(req("How do I request PTO?"), ctx, "pto-answer", 60);
    expect(c.lookup(req("How do I book annual leave?"), ctx, "standard", 0.75)).toBeUndefined();
  });

  it("keeps every cross-topic pair below the default threshold", () => {
    for (const a of TOPICS) {
      for (const b of TOPICS) {
        if (a === b) continue;
        for (const q of [b.canonical, ...b.paraphrases]) {
          expect(similarity(embed(a.canonical), embed(q)), `${a.canonical} vs ${q}`).toBeLessThan(0.75);
        }
      }
    }
  });
});
