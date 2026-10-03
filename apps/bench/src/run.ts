import { randomUUID } from "node:crypto";
import {
  SYSTEM_PROMPT,
  buildWorkload,
  savingsVsBaseline,
  summarize,
  type CacheMode,
  type GatewayClient,
  type GatewayInfo,
  type ModeSummary,
  type Pricing,
  type QuestionKind,
  type RequestRecord,
  type Savings,
  type WorkloadItem,
} from "@demo/core";

export interface BenchOptions {
  requests: number;
  seed: number;
  modes: CacheMode[];
  threshold?: number;
  concurrency: number;
  onProgress?: (mode: CacheMode, done: number, total: number, hit: boolean) => void;
}

export interface ItemResult extends RequestRecord {
  index: number;
  kind: QuestionKind;
  question: string;
  matchScore?: number;
  error?: string;
}

export interface ModeRun {
  mode: CacheMode;
  summary: ModeSummary;
  /** Time the model spent generating (sum of miss latencies) - a proxy for upstream compute. */
  modelBusyMs: number;
  hitRateByKind: Record<QuestionKind, { requests: number; hits: number }>;
  items: ItemResult[];
  errors: number;
}

export interface BenchResult {
  runId: string;
  startedAt: string;
  /** gateway: GET /v1/info at run time (null if unavailable). */
  target: { endpoint: string; model: string; mock: boolean; gateway?: GatewayInfo | null };
  pricing: Pricing;
  options: Omit<BenchOptions, "onProgress">;
  workload: WorkloadItem[];
  runs: ModeRun[];
  savings: Partial<Record<CacheMode, Savings & { modelBusySavedMs: number }>>;
}

async function runMode(
  client: GatewayClient,
  mode: CacheMode,
  workload: WorkloadItem[],
  runId: string,
  opts: BenchOptions,
  pricing: Pricing,
): Promise<ModeRun> {
  // A per-run, per-mode tag in the system prompt starts every run with a cold cache:
  // the gateway's cache key (and semantic filter hash) includes the system prompt.
  const system = `${SYSTEM_PROMPT}\n\n[benchmark run ${runId}-${mode}]`;
  const items: ItemResult[] = new Array(workload.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < workload.length) {
      const w = workload[next++];
      try {
        const r = await client.chat(
          [
            { role: "system", content: system },
            { role: "user", content: w.question },
          ],
          { mode, threshold: opts.threshold },
        );
        items[w.index] = {
          index: w.index,
          kind: w.kind,
          question: w.question,
          mode,
          cacheHit: r.cacheHit,
          latencyMs: r.latencyMs,
          promptTokens: r.usage.prompt_tokens,
          completionTokens: r.usage.completion_tokens,
          matchScore: r.matchScore,
        };
      } catch (err) {
        items[w.index] = {
          index: w.index,
          kind: w.kind,
          question: w.question,
          mode,
          cacheHit: false,
          latencyMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      done++;
      opts.onProgress?.(mode, done, workload.length, items[w.index].cacheHit);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));

  const ok = items.filter((i) => !i.error);
  const hitRateByKind = { exact: { requests: 0, hits: 0 }, paraphrase: { requests: 0, hits: 0 }, unique: { requests: 0, hits: 0 } };
  for (const i of ok) {
    hitRateByKind[i.kind].requests++;
    if (i.cacheHit) hitRateByKind[i.kind].hits++;
  }
  return {
    mode,
    summary: summarize(mode, ok, pricing),
    modelBusyMs: ok.filter((i) => !i.cacheHit).reduce((a, i) => a + i.latencyMs, 0),
    hitRateByKind,
    items,
    errors: items.length - ok.length,
  };
}

export async function runBench(
  client: GatewayClient,
  target: BenchResult["target"],
  pricing: Pricing,
  opts: BenchOptions,
): Promise<BenchResult> {
  const runId = randomUUID().slice(0, 8);
  const workload = buildWorkload({ requests: opts.requests, seed: opts.seed });
  const modes: CacheMode[] = opts.modes.includes("none") ? opts.modes : ["none", ...opts.modes];
  const runs: ModeRun[] = [];
  for (const mode of modes) runs.push(await runMode(client, mode, workload, runId, opts, pricing));

  const base = runs.find((r) => r.mode === "none")!;
  const savings: BenchResult["savings"] = {};
  for (const r of runs) {
    if (r.mode === "none") continue;
    savings[r.mode] = { ...savingsVsBaseline(base.summary, r.summary), modelBusySavedMs: base.modelBusyMs - r.modelBusyMs };
  }
  const { onProgress: _p, ...options } = opts;
  return { runId, startedAt: new Date().toISOString(), target, pricing, options, workload, runs, savings };
}
