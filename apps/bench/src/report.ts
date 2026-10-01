import type { CacheMode } from "@demo/core";
import type { BenchResult, ModeRun } from "./run";

const LABEL: Record<CacheMode, string> = { none: "No cache", standard: "Standard cache", semantic: "Semantic cache" };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const usd = (x: number) => `$${x.toFixed(x < 1 ? 4 : 2)}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function kindCell(r: ModeRun, k: "exact" | "paraphrase" | "unique") {
  const v = r.hitRateByKind[k];
  return v.requests ? `${v.hits}/${v.requests} (${pct(v.hits / v.requests)})` : "-";
}

export function toMarkdown(b: BenchResult): string {
  const lines: string[] = [];
  lines.push(`# Cache benchmark - ${b.startedAt}`);
  lines.push("");
  lines.push(
    `Target: **${b.target.mock ? "mock gateway (simulated Bedrock)" : "Capella Model Service"}** · model \`${b.target.model}\` · ` +
      `${b.options.requests} helpdesk questions per mode (seed ${b.options.seed}, concurrency ${b.options.concurrency})`,
  );
  lines.push(`Pricing: $${b.pricing.inputPerMTok}/M input, $${b.pricing.outputPerMTok}/M output (${b.pricing.source})`);
  lines.push("");
  lines.push("## Savings vs no cache");
  lines.push("");
  lines.push("| | Tokens saved | $ saved | Bedrock calls avoided | Avg latency | p95 latency | Model time saved |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const [mode, s] of Object.entries(b.savings) as [CacheMode, NonNullable<BenchResult["savings"][CacheMode]>][]) {
    lines.push(
      `| ${LABEL[mode]} | ${num(s.tokensSaved)} (${pct(s.tokensSavedPct)}) | ${usd(s.costSavedUSD)} | ` +
        `${s.upstreamCallsAvoided} (${pct(s.upstreamCallsAvoidedPct)}) | -${ms(s.avgLatencySavedMs)} (${pct(s.avgLatencySavedPct)}) | ` +
        `-${ms(s.p95LatencySavedMs)} | ${ms(s.modelBusySavedMs)} |`,
    );
  }
  lines.push("");
  lines.push("## Per mode");
  lines.push("");
  lines.push("| Mode | Hit rate | Bedrock calls | Billed tokens | Cost | Avg | p50 | p95 | Hit avg | Miss avg | Errors |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of b.runs) {
    const s = r.summary;
    lines.push(
      `| ${LABEL[r.mode]} | ${pct(s.hitRate)} | ${s.upstreamCalls} | ${num(s.billedTokens)} | ${usd(s.costUSD)} | ` +
        `${ms(s.latency.avg)} | ${ms(s.latency.p50)} | ${ms(s.latency.p95)} | ${s.hits ? ms(s.latency.hitAvg) : "-"} | ` +
        `${ms(s.latency.missAvg)} | ${r.errors} |`,
    );
  }
  lines.push("");
  lines.push("## Hit rate by question type");
  lines.push("");
  lines.push("| Mode | Exact repeats (chips) | Paraphrases | One-off questions |");
  lines.push("|---|---|---|---|");
  for (const r of b.runs) {
    lines.push(`| ${LABEL[r.mode]} | ${kindCell(r, "exact")} | ${kindCell(r, "paraphrase")} | ${kindCell(r, "unique")} |`);
  }
  lines.push("");
  lines.push(
    "Billed tokens count only requests that reached the model; a cache hit returns the stored answer, " +
      "including its original `usage`, without calling Bedrock. Model time saved is the generation time " +
      "Bedrock did not have to spend.",
  );
  return lines.join("\n") + "\n";
}

const COLORS: Record<CacheMode, string> = { none: "var(--c-none)", standard: "var(--c-std)", semantic: "var(--c-sem)" };

function bars(title: string, unit: (v: number) => string, rows: { mode: CacheMode; value: number }[]): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption>${rows
    .map(
      (r) => `<div class="row"><span class="lbl">${LABEL[r.mode]}</span><span class="track"><span class="bar" style="width:${(
        (r.value / max) *
        100
      ).toFixed(1)}%;background:${COLORS[r.mode]}"></span></span><span class="val">${esc(unit(r.value))}</span></div>`,
    )
    .join("")}</figure>`;
}

export function toHtml(b: BenchResult): string {
  const best = (Object.entries(b.savings) as [CacheMode, NonNullable<BenchResult["savings"][CacheMode]>][]).sort(
    (x, y) => y[1].tokensSaved - x[1].tokensSaved,
  )[0];
  const tiles = best
    ? [
        ["Tokens saved", pct(best[1].tokensSavedPct), `${num(best[1].tokensSaved)} tokens · ${usd(best[1].costSavedUSD)}`],
        ["Faster on average", pct(best[1].avgLatencySavedPct), `-${ms(best[1].avgLatencySavedMs)} per answer`],
        ["Bedrock calls avoided", pct(best[1].upstreamCallsAvoidedPct), `${best[1].upstreamCallsAvoided} of ${b.options.requests} calls`],
        ["Model time freed", ms(best[1].modelBusySavedMs), "generation time not spent"],
      ]
    : [];
  const runs = b.runs;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cache Benchmark Report</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap">
<style>
:root{--bg:#F7F7F7;--card:#FFFFFF;--fg:#000000;--muted:#2E2E2E;--line:#E6E6E6;--c-none:#A8A8A8;--c-std:#FC9C0C;--c-sem:#EC1218;--accent:#EC1218}
@media (prefers-color-scheme:dark){:root{--bg:#000000;--card:#2E2E2E;--fg:#FFFFFF;--muted:#A8A8A8;--line:#444444;--c-none:#A8A8A8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 'Open Sans',system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 12px}
.sub{color:var(--muted);margin:0 0 24px}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.tile b{display:block;font-size:28px;color:var(--accent)}
.tile span{color:var(--muted);font-size:13px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.chart{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}figcaption{font-weight:600;margin-bottom:10px}
.row{display:grid;grid-template-columns:110px 1fr 90px;gap:8px;align-items:center;margin:6px 0;font-size:13px}.track{background:var(--line);border-radius:4px;height:12px}
.bar{display:block;height:12px;border-radius:4px}.val{text-align:right;font-variant-numeric:tabular-nums}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;font-size:13px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}
th{color:var(--muted);font-weight:600}.note{color:var(--muted);font-size:13px}
</style></head><body><main>
<h1>Capella Model Service cache benchmark</h1>
<p class="sub">${esc(b.target.mock ? "Mock gateway (simulated Bedrock)" : "Capella Model Service")} · ${esc(b.target.model)} ·
${b.options.requests} helpdesk questions per mode · ${esc(b.startedAt)}</p>
${best ? `<p class="sub">Headline numbers are for <b>${LABEL[best[0]]}</b> vs no cache.</p>` : ""}
<section class="tiles">${tiles.map(([t, v, s]) => `<div class="tile">${esc(t)}<b>${esc(v)}</b><span>${esc(s)}</span></div>`).join("")}</section>
<h2>Token saving · Less latency · Resource saving</h2>
<div class="grid">
${bars("Billed tokens", num, runs.map((r) => ({ mode: r.mode, value: r.summary.billedTokens })))}
${bars("Average latency", ms, runs.map((r) => ({ mode: r.mode, value: r.summary.latency.avg })))}
${bars("p95 latency", ms, runs.map((r) => ({ mode: r.mode, value: r.summary.latency.p95 })))}
${bars("Bedrock calls", num, runs.map((r) => ({ mode: r.mode, value: r.summary.upstreamCalls })))}
${bars("Model generation time", ms, runs.map((r) => ({ mode: r.mode, value: r.modelBusyMs })))}
${bars("Estimated cost", usd, runs.map((r) => ({ mode: r.mode, value: r.summary.costUSD })))}
</div>
<h2>Hit rate by question type</h2>
<div class="tbl"><table><tr><th>Mode</th><th>Exact repeats (chips)</th><th>Paraphrases</th><th>One-off questions</th><th>Overall</th></tr>
${runs
  .map(
    (r) =>
      `<tr><td>${LABEL[r.mode]}</td><td>${kindCell(r, "exact")}</td><td>${kindCell(r, "paraphrase")}</td><td>${kindCell(r, "unique")}</td><td>${pct(r.summary.hitRate)}</td></tr>`,
  )
  .join("")}</table></div>
<h2>Per mode</h2>
<div class="tbl"><table><tr><th>Mode</th><th>Bedrock calls</th><th>Billed tokens</th><th>Cost</th><th>Avg</th><th>p50</th><th>p95</th><th>Hit avg</th><th>Miss avg</th><th>Errors</th></tr>
${runs
  .map((r) => {
    const s = r.summary;
    return `<tr><td>${LABEL[r.mode]}</td><td>${s.upstreamCalls}</td><td>${num(s.billedTokens)}</td><td>${usd(s.costUSD)}</td><td>${ms(s.latency.avg)}</td><td>${ms(s.latency.p50)}</td><td>${ms(s.latency.p95)}</td><td>${s.hits ? ms(s.latency.hitAvg) : "-"}</td><td>${ms(s.latency.missAvg)}</td><td>${r.errors}</td></tr>`;
  })
  .join("")}</table></div>
<p class="note">Billed tokens count only requests that reached the model. Cache hits return the stored answer, with its original usage, without calling Bedrock.
Pricing: $${b.pricing.inputPerMTok}/M input, $${b.pricing.outputPerMTok}/M output (${esc(b.pricing.source)}).</p>
</main></body></html>
`;
}
