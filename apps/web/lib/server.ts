import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GatewayClient, clientFromEnv, isMock, pricingFromEnv } from "@demo/core";

/** Connection preferences sent by the browser (Connection settings dialog). */
export interface ConnectionPrefs {
  source: "server" | "mock" | "custom";
  endpoint?: string;
  apiKey?: string;
  model?: string;
}

export interface ResolvedConnection {
  endpoint: string;
  apiKey: string;
  model: string;
}

const DEFAULT_MODEL = "anthropic.claude-sonnet-5-5";
const debug = () => (process.env.CMS_DEBUG ?? "true").toLowerCase() === "true";
const mockEndpoint = () => `http://localhost:${process.env.MOCK_PORT ?? "8787"}`;

/** Set DISABLE_UI_CONNECTION=true on shared deployments so the server never calls a browser-supplied URL. */
export const customConnectionAllowed = () => (process.env.DISABLE_UI_CONNECTION ?? "false").toLowerCase() !== "true";

export class ConnectionError extends Error {}

let envClient: GatewayClient | undefined;

/**
 * Resolves where to send a request. "server" uses .env; "mock" the local mock gateway;
 * "custom" the endpoint, key and model saved in the browser. Keys are never logged.
 */
export function resolveConnection(prefs?: ConnectionPrefs): ResolvedConnection {
  const source = prefs?.source ?? "server";
  if (source === "mock") {
    return { endpoint: mockEndpoint(), apiKey: "mock-key", model: prefs?.model || process.env.CMS_MODEL || DEFAULT_MODEL };
  }
  if (source === "custom") {
    if (!customConnectionAllowed()) throw new ConnectionError("Custom connections are disabled on this server");
    const endpoint = prefs?.endpoint?.trim() ?? "";
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new ConnectionError("Enter a valid endpoint URL, e.g. https://<id>.ai.cloud.couchbase.com");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ConnectionError("Endpoint must be http(s)");
    if (!prefs?.apiKey) throw new ConnectionError("Enter an API key");
    if (!prefs.model) throw new ConnectionError("Choose a model");
    return { endpoint: url.origin + url.pathname.replace(/\/+$/, ""), apiKey: prefs.apiKey, model: prefs.model };
  }
  const mock = isMock();
  const endpoint = mock ? mockEndpoint() : process.env.CMS_ENDPOINT;
  const apiKey = mock ? "mock-key" : process.env.CMS_API_KEY;
  if (!endpoint || !apiKey) throw new ConnectionError("Server .env has no CMS_ENDPOINT / CMS_API_KEY; set USE_MOCK=true or use Connection settings");
  return { endpoint, apiKey, model: prefs?.model || process.env.CMS_MODEL || DEFAULT_MODEL };
}

/** A gateway client for this request; the API key stays on the server. */
export function gatewayFor(prefs?: ConnectionPrefs): GatewayClient {
  if (!prefs || (prefs.source === "server" && !prefs.model)) {
    envClient ??= clientFromEnv();
    return envClient;
  }
  return new GatewayClient({ ...resolveConnection(prefs), debug: debug() });
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
  return {
    mock,
    model: process.env.CMS_MODEL ?? DEFAULT_MODEL,
    endpointHost,
    pricing: pricingFromEnv(),
    customConnectionAllowed: customConnectionAllowed(),
  };
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
