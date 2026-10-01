import { describe, expect, it } from "vitest";
import { percentile, savingsVsBaseline, summarize, DEFAULT_PRICING, buildWorkload } from "../packages/core/src/index.js";

describe("stats", () => {
  it("bills tokens only for misses", () => {
    const s = summarize(
      "standard",
      [
        { mode: "standard", cacheHit: false, latencyMs: 3000, promptTokens: 100, completionTokens: 200 },
        { mode: "standard", cacheHit: true, latencyMs: 40, promptTokens: 100, completionTokens: 200 },
      ],
      DEFAULT_PRICING,
    );
    expect(s.billedTokens).toBe(300);
    expect(s.upstreamCalls).toBe(1);
    expect(s.hitRate).toBe(0.5);
    expect(s.costUSD).toBeCloseTo((100 * 2 + 200 * 10) / 1e6);
  });

  it("computes savings against the baseline", () => {
    const rec = (hit: boolean, ms: number) => ({ mode: "none" as const, cacheHit: hit, latencyMs: ms, promptTokens: 50, completionTokens: 150 });
    const base = summarize("none", [rec(false, 3000), rec(false, 3000)], DEFAULT_PRICING);
    const cached = summarize("semantic", [rec(false, 3000), rec(true, 50)], DEFAULT_PRICING);
    const sv = savingsVsBaseline(base, cached);
    expect(sv.tokensSaved).toBe(200);
    expect(sv.tokensSavedPct).toBe(0.5);
    expect(sv.upstreamCallsAvoided).toBe(1);
    expect(sv.waitTimeSavedMs).toBe(2950);
  });

  it("percentile uses nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it("builds the same workload for the same seed", () => {
    const a = buildWorkload({ requests: 50, seed: 7 });
    const b = buildWorkload({ requests: 50, seed: 7 });
    expect(a).toEqual(b);
    expect(new Set(a.map((i) => i.kind))).toEqual(new Set(["exact", "paraphrase", "unique"]));
  });
});
