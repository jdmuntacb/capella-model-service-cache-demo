import { costUSD, type Pricing } from "./pricing";
import type { CacheMode } from "./headers";

export interface RequestRecord {
  mode: CacheMode;
  cacheHit: boolean;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ModeSummary {
  mode: CacheMode;
  requests: number;
  hits: number;
  hitRate: number;
  /** Calls that reached the upstream model (Bedrock). */
  upstreamCalls: number;
  /** Tokens actually processed by the model, i.e. on misses only. */
  billedPromptTokens: number;
  billedCompletionTokens: number;
  billedTokens: number;
  costUSD: number;
  latency: { avg: number; p50: number; p95: number; hitAvg: number; missAvg: number };
  totalLatencyMs: number;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

export function summarize(mode: CacheMode, records: RequestRecord[], pricing: Pricing): ModeSummary {
  const misses = records.filter((r) => !r.cacheHit);
  const hits = records.filter((r) => r.cacheHit);
  const billedPromptTokens = misses.reduce((a, r) => a + r.promptTokens, 0);
  const billedCompletionTokens = misses.reduce((a, r) => a + r.completionTokens, 0);
  const lat = records.map((r) => r.latencyMs);
  return {
    mode,
    requests: records.length,
    hits: hits.length,
    hitRate: records.length ? hits.length / records.length : 0,
    upstreamCalls: misses.length,
    billedPromptTokens,
    billedCompletionTokens,
    billedTokens: billedPromptTokens + billedCompletionTokens,
    costUSD: costUSD(billedPromptTokens, billedCompletionTokens, pricing),
    latency: {
      avg: mean(lat),
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      hitAvg: mean(hits.map((r) => r.latencyMs)),
      missAvg: mean(misses.map((r) => r.latencyMs)),
    },
    totalLatencyMs: lat.reduce((a, b) => a + b, 0),
  };
}

export interface Savings {
  tokensSaved: number;
  tokensSavedPct: number;
  costSavedUSD: number;
  upstreamCallsAvoided: number;
  upstreamCallsAvoidedPct: number;
  avgLatencySavedMs: number;
  avgLatencySavedPct: number;
  p95LatencySavedMs: number;
  /** Total wall-clock time users spent waiting, saved across the run. */
  waitTimeSavedMs: number;
}

/** Compares a cached run against the no-cache baseline over the same workload. */
export function savingsVsBaseline(baseline: ModeSummary, cached: ModeSummary): Savings {
  const pct = (saved: number, base: number) => (base > 0 ? saved / base : 0);
  const tokensSaved = baseline.billedTokens - cached.billedTokens;
  const calls = baseline.upstreamCalls - cached.upstreamCalls;
  const avgLat = baseline.latency.avg - cached.latency.avg;
  return {
    tokensSaved,
    tokensSavedPct: pct(tokensSaved, baseline.billedTokens),
    costSavedUSD: baseline.costUSD - cached.costUSD,
    upstreamCallsAvoided: calls,
    upstreamCallsAvoidedPct: pct(calls, baseline.upstreamCalls),
    avgLatencySavedMs: avgLat,
    avgLatencySavedPct: pct(avgLat, baseline.latency.avg),
    p95LatencySavedMs: baseline.latency.p95 - cached.latency.p95,
    waitTimeSavedMs: baseline.totalLatencyMs - cached.totalLatencyMs,
  };
}

/** Rough token estimate used only when a cached response carries no usage block. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
