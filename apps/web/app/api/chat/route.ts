import { CACHE_MODES, GatewayError, SYSTEM_PROMPT, type CacheMode, type ChatMessage } from "@demo/core";
import { gateway } from "@/lib/server";

export const dynamic = "force-dynamic";

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  mode: CacheMode;
  topic?: string;
  threshold?: number;
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!CACHE_MODES.includes(body.mode)) return Response.json({ error: "invalid mode" }, { status: 400 });
  const turns = (body.messages ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim(),
  );
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    return Response.json({ error: "last message must be from the user" }, { status: 400 });
  }
  // The system prompt is fixed server-side: the gateway's cache key includes it.
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...turns.slice(-12)];
  try {
    const result = await gateway().chat(messages, {
      mode: body.mode,
      topic: body.topic || undefined,
      threshold: typeof body.threshold === "number" ? body.threshold : undefined,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof GatewayError) {
      return Response.json({ error: `Gateway returned ${err.status}`, detail: err.body }, { status: 502 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Could not reach the gateway: ${msg}` }, { status: 502 });
  }
}
