// In-memory imitation of the AI Gateway cache (ai-gateway pkg/cache/v2).
//
// Standard: document key = sha256 of the whole request (messages and params, minus
//   stream/stream_options) plus X-cb-attr-* attributes, caller identity and system prompt.
// Semantic: try the exact key first; otherwise search entries that share the request
//   hash *without* messages (same model, params, system prompt, attributes, caller) and
//   take the best similarity >= threshold.
//
// One simplification: the real gateway compares the last user message against the
// embedding of each cached *response* (query/passage embedding model). With no real
// embedding model offline, the mock compares it to the cached request's last user message.
import { createHash } from "node:crypto";
import { embed, similarity, type Vector } from "./embed";

export interface ChatRequestBody {
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
  stream_options?: unknown;
  [k: string]: unknown;
}

export interface CacheContext {
  attributes: Record<string, string>;
  identity: string;
}

interface Entry<T> {
  key: string;
  hash: string;
  vector: Vector;
  value: T;
  expiresAt: number;
}

export interface LookupResult<T> {
  value: T;
  score: number;
  kind: "standard" | "semantic";
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function systemPrompt(body: ChatRequestBody): string {
  for (const m of body.messages) {
    if (m.role === "user") break;
    if (m.role === "system") return m.content;
  }
  return "";
}

export function lastUserMessage(body: ChatRequestBody): string {
  for (let i = body.messages.length - 1; i >= 0; i--) {
    if (body.messages[i].role === "user") return body.messages[i].content;
  }
  return "";
}

function digest(body: ChatRequestBody, ctx: CacheContext, includeMessages: boolean): string {
  const { stream: _s, stream_options: _so, ...rest } = body;
  const material: Record<string, unknown> = {
    ...rest,
    conversation_attributes: ctx.attributes,
    couchbase_user: ctx.identity,
    system_prompt: systemPrompt(body),
  };
  if (!includeMessages) delete material.messages;
  return createHash("sha256").update(stableStringify(material)).digest("hex");
}

export const standardKey = (b: ChatRequestBody, c: CacheContext) => `cache-${digest(b, c, true)}`;
export const semanticHash = (b: ChatRequestBody, c: CacheContext) => digest(b, c, false);

export class GatewayCache<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    this.evictExpired();
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  lookup(
    body: ChatRequestBody,
    ctx: CacheContext,
    mode: "standard" | "semantic",
    threshold: number,
  ): LookupResult<T> | undefined {
    this.evictExpired();
    const exact = this.entries.get(standardKey(body, ctx));
    if (exact) return { value: exact.value, score: 1, kind: "standard" };
    if (mode === "standard") return undefined;

    const hash = semanticHash(body, ctx);
    const q = embed(lastUserMessage(body));
    let best: Entry<T> | undefined;
    let bestScore = -Infinity;
    for (const e of this.entries.values()) {
      if (e.hash !== hash) continue;
      const s = similarity(q, e.vector);
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    if (best && bestScore >= threshold) return { value: best.value, score: bestScore, kind: "semantic" };
    return undefined;
  }

  /** Upserts the entry; like the gateway, this also runs on hits and refreshes the TTL. */
  store(body: ChatRequestBody, ctx: CacheContext, value: T, ttlSeconds: number): void {
    const key = standardKey(body, ctx);
    this.entries.set(key, {
      key,
      hash: semanticHash(body, ctx),
      vector: embed(lastUserMessage(body)),
      value,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
  }

  private evictExpired(): void {
    const t = this.now();
    for (const [k, e] of this.entries) if (e.expiresAt <= t) this.entries.delete(k);
  }
}
