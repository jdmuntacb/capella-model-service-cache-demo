import { GatewayError } from "@demo/core";
import { ConnectionError, gatewayFor, type ConnectionPrefs } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Embeds one message with the selected embedding model (POST /v1/embeddings). */
export async function POST(req: Request) {
  let body: { input?: unknown; connection?: ConnectionPrefs };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) return Response.json({ error: "input is required" }, { status: 400 });
  if (input.length > 8000) return Response.json({ error: "input is too long (8000 characters max)" }, { status: 400 });
  try {
    return Response.json(await gatewayFor(body.connection).embed(input, { trace: true }));
  } catch (err) {
    if (err instanceof ConnectionError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof GatewayError) return Response.json({ error: err.message, detail: err.body, trace: err.trace }, { status: 502 });
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Could not reach the gateway: ${msg}` }, { status: 502 });
  }
}
