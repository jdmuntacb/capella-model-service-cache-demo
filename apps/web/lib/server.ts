import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { clientFromEnv, isMock, pricingFromEnv, type GatewayClient } from "@demo/core";

let client: GatewayClient | undefined;

/** One gateway client per server process; the API key never reaches the browser. */
export function gateway(): GatewayClient {
  client ??= clientFromEnv();
  return client;
}

export function publicConfig() {
  const mock = isMock();
  let endpointHost = "localhost (mock)";
  if (!mock && process.env.CMS_ENDPOINT) {
    try {
      endpointHost = new URL(process.env.CMS_ENDPOINT).host;
    } catch {
      endpointHost = "invalid CMS_ENDPOINT";
    }
  }
  return { mock, model: process.env.CMS_MODEL ?? "anthropic.claude-sonnet-5-5", endpointHost, pricing: pricingFromEnv() };
}

const REPORTS = resolve(process.cwd(), "../../reports");

/** Latest `npm run bench` result, if any, for the "Benchmark" view. */
export async function latestBenchmark(): Promise<unknown | null> {
  try {
    const dirs = (await readdir(REPORTS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const d of dirs.reverse()) {
      try {
        const raw = JSON.parse(await readFile(join(REPORTS, d, "results.json"), "utf8"));
        // Drop per-request detail; the UI only needs the summaries.
        return { ...raw, workload: undefined, runs: raw.runs.map((r: { items?: unknown }) => ({ ...r, items: undefined })), dir: d };
      } catch {
        continue;
      }
    }
  } catch {
    // no reports yet
  }
  return null;
}
