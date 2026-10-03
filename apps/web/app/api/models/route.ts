import { GatewayError, getInfo, listModels } from "@demo/core";
import { ConnectionError, resolveConnection, type ConnectionPrefs } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Tests a connection, lists its models and reads /v1/info. POST so the API key travels in the body, not the URL. */
export async function POST(req: Request) {
  let prefs: ConnectionPrefs;
  try {
    prefs = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    // A model is not needed just to list models.
    const conn = resolveConnection({ ...prefs, model: prefs.model || "-" });
    const started = performance.now();
    const [models, info] = await Promise.all([
      listModels(conn.endpoint, conn.apiKey, AbortSignal.timeout(15_000)),
      // Version and model health are a bonus; older gateways may not serve /v1/info.
      getInfo(conn.endpoint, conn.apiKey, AbortSignal.timeout(15_000)).catch(() => null),
    ]);
    return Response.json({ models, info, latencyMs: performance.now() - started, endpointHost: new URL(conn.endpoint).host });
  } catch (err) {
    if (err instanceof ConnectionError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof GatewayError) {
      const hint = err.status === 401 || err.status === 403 ? " (check the API key)" : "";
      return Response.json({ error: `${err.message}${hint}`, detail: err.body }, { status: 502 });
    }
    const msg = err instanceof Error ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message) : String(err);
    return Response.json({ error: `Could not reach the gateway: ${msg}` }, { status: 502 });
  }
}
