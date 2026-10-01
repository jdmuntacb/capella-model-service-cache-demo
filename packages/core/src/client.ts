import { HEADERS, type CacheMode } from "./headers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatOptions {
  mode: CacheMode;
  /** Scopes the cache to a conversation via X-cb-attr-topic. */
  topic?: string;
  /** Overrides the semantic similarity threshold for this request. */
  threshold?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  usage: Usage;
  cacheHit: boolean;
  /** Similarity score reported on semantic hits (debug mode only). */
  matchScore?: number;
  latencyMs: number;
  mode: CacheMode;
  model: string;
  /** A miss means the gateway called the upstream model (Bedrock). */
  upstreamCalled: boolean;
}

export interface GatewayConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  debug?: boolean;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class GatewayClient {
  constructor(private readonly cfg: GatewayConfig) {}

  get model(): string {
    return this.cfg.model;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.cfg.apiKey}`,
      [HEADERS.cacheType]: opts.mode,
    };
    if (opts.topic) headers[`${HEADERS.attributePrefix}topic`] = opts.topic;
    if (opts.threshold !== undefined) headers[HEADERS.cacheThreshold] = String(opts.threshold);
    if (this.cfg.debug) headers[HEADERS.debug] = "true";

    const body = {
      model: this.cfg.model,
      messages,
      max_tokens: opts.maxTokens ?? 512,
      stream: false,
    };

    const url = `${this.cfg.endpoint.replace(/\/+$/, "")}/v1/chat/completions`;
    const started = performance.now();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    const text = await res.text();
    const latencyMs = performance.now() - started;

    if (!res.ok) {
      throw new GatewayError(`Gateway returned ${res.status}`, res.status, text.slice(0, 500));
    }

    const json = JSON.parse(text) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: Partial<Usage>;
    };
    const cacheHit = res.headers.get(HEADERS.cacheHit)?.toUpperCase() === "HIT";
    const score = res.headers.get(HEADERS.matchScore);
    const usage: Usage = {
      prompt_tokens: json.usage?.prompt_tokens ?? 0,
      completion_tokens: json.usage?.completion_tokens ?? 0,
      total_tokens:
        json.usage?.total_tokens ??
        (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0),
    };

    return {
      content: json.choices?.[0]?.message?.content ?? "",
      usage,
      cacheHit,
      matchScore: score ? Number(score) : undefined,
      latencyMs,
      mode: opts.mode,
      model: json.model ?? this.cfg.model,
      upstreamCalled: !cacheHit,
    };
  }
}

/** Builds a client from CMS_* env vars, pointing at the mock gateway when USE_MOCK=true. */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): GatewayClient {
  const useMock = (env.USE_MOCK ?? "true").toLowerCase() === "true";
  const endpoint = useMock ? `http://localhost:${env.MOCK_PORT ?? "8787"}` : env.CMS_ENDPOINT;
  const apiKey = useMock ? "mock-key" : env.CMS_API_KEY;
  if (!endpoint || !apiKey) {
    throw new Error("Set CMS_ENDPOINT and CMS_API_KEY in .env, or USE_MOCK=true");
  }
  return new GatewayClient({
    endpoint,
    apiKey,
    model: env.CMS_MODEL ?? "anthropic.claude-sonnet-5-5",
    debug: (env.CMS_DEBUG ?? "true").toLowerCase() === "true",
  });
}

export function isMock(env: Record<string, string | undefined> = process.env): boolean {
  return (env.USE_MOCK ?? "true").toLowerCase() === "true";
}
