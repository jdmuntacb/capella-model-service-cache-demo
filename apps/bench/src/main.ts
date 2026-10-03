import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CACHE_MODES, clientFromEnv, getInfo, isMock, pricingFromEnv, type CacheMode } from "@demo/core";
import { runBench } from "./run";
import { toHtml, toMarkdown } from "./report";

const { values } = parseArgs({
  options: {
    requests: { type: "string", short: "n", default: "60" },
    seed: { type: "string", default: "42" },
    modes: { type: "string", default: "none,standard,semantic" },
    threshold: { type: "string" },
    concurrency: { type: "string", short: "c", default: "1" },
    out: { type: "string", default: "../../reports" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`Usage: npm run bench -- [options]
  -n, --requests <n>     questions per mode (default 60)
      --seed <n>         workload seed (default 42)
      --modes <list>     comma list of none,standard,semantic (none is always run as the baseline)
      --threshold <x>    semantic threshold override sent as X-cb-cache-threshold
  -c, --concurrency <n>  parallel requests (default 1; >1 lets identical in-flight requests both miss)
      --out <dir>        report directory (default reports/)`);
  process.exit(0);
}

const modes = values.modes!.split(",").map((m) => m.trim()) as CacheMode[];
for (const m of modes) if (!CACHE_MODES.includes(m)) throw new Error(`unknown mode ${m}`);

const client = clientFromEnv();
const mock = isMock();
const endpoint = mock ? `http://localhost:${process.env.MOCK_PORT ?? "8787"}` : process.env.CMS_ENDPOINT!;
const pricing = pricingFromEnv();

if (mock) {
  const ok = await fetch(`${endpoint}/health`).then((r) => r.ok, () => false);
  if (!ok) {
    console.error(`Mock gateway is not running on ${endpoint}. Start it with: npm run mock`);
    process.exit(1);
  }
}

// Record which gateway build and models produced these numbers.
const gateway = await getInfo(endpoint, mock ? "mock-key" : process.env.CMS_API_KEY!, AbortSignal.timeout(15_000)).catch((err) => {
  console.warn(`Could not read ${endpoint}/v1/info: ${err instanceof Error ? err.message : err}`);
  return null;
});
console.log(
  `Benchmarking ${mock ? "mock gateway" : endpoint} · model ${client.model}` +
    (gateway ? ` · gateway ${gateway.version}${gateway.commitHash ? ` (${gateway.commitHash})` : ""}` : ""),
);
const result = await runBench(
  client,
  { endpoint: mock ? "mock" : new URL(endpoint).host, model: client.model, mock, gateway },
  pricing,
  {
    requests: Number(values.requests),
    seed: Number(values.seed),
    modes,
    threshold: values.threshold !== undefined ? Number(values.threshold) : undefined,
    concurrency: Number(values.concurrency),
    onProgress: (mode, done, total, hit) => {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r  ${mode.padEnd(8)} ${String(done).padStart(4)}/${total} ${hit ? "HIT " : "miss"}`);
        if (done === total) process.stdout.write("\n");
      } else if (done === total) {
        console.log(`  ${mode.padEnd(8)} done (${total} requests)`);
      }
    },
  },
);

const md = toMarkdown(result);
const dir = resolve(values.out!, `${result.startedAt.replace(/[:.]/g, "-")}-${result.runId}`);
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "report.md"), md);
await writeFile(join(dir, "report.html"), toHtml(result));
await writeFile(join(dir, "results.json"), JSON.stringify(result, null, 2));
console.log("\n" + md);
console.log(`Report written to ${dir}/report.html`);
const errors = result.runs.reduce((a, r) => a + r.errors, 0);
if (errors) {
  const first = result.runs.flatMap((r) => r.items).find((i) => i.error);
  console.error(`${errors} request(s) failed, e.g. ${first?.error}`);
  process.exitCode = 1;
}
