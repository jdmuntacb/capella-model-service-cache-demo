import type { CacheMode, Trace } from "@demo/core";

export interface Explanation {
  verdict: string;
  tone: "hit" | "miss" | "off" | "error";
  steps: string[];
}

export interface ExplainInput {
  mode: CacheMode;
  cacheHit: boolean;
  matchScore?: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  scoped: boolean;
  trace?: Trace;
  error?: string;
  /** The same first-turn question already went through the cache earlier this session and still missed. */
  repeatMiss?: boolean;
  /** Set for POST /v1/embeddings calls (an embedding model was selected). */
  embedding?: EmbeddingInfo;
}

export interface EmbeddingInfo {
  model: string;
  dimensions: number;
  /** Earlier questions in the same conversation, most similar first. */
  nearest?: { question: string; score: number }[];
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** Reads the gateway's response headers (X-Cache plus X-cb-debug headers) and says what happened, in plain language. */
export function explain(x: ExplainInput): Explanation {
  const h = x.trace?.response?.headers ?? {};
  const tokens = `${(x.promptTokens + x.completionTokens).toLocaleString()} tokens (${x.promptTokens} prompt + ${x.completionTokens} completion)`;
  const debugOn = "x-cb-cache-enabled" in h;
  const threshold = Number(h["x-cb-semantic-cache-match-threshold"]);
  const thr = Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold.toFixed(2) : undefined;
  const embedding = h["x-cb-semantic-cache-embedding-model"];
  const expiry = h["x-cb-cache-expiry"];
  const scope = x.scoped ? "X-cb-attr-topic limited the lookup to entries from this conversation." : undefined;

  if (x.error || x.trace?.networkError || (x.trace?.response?.status ?? 200) >= 400) {
    const status = x.trace?.response?.status;
    const steps = [
      x.trace?.networkError
        ? `The demo server could not connect to ${hostOf(x.trace.request.url)}: ${x.trace.networkError}.`
        : status
          ? `The gateway answered with HTTP ${status}. ${statusHint(status)}`
          : (x.error ?? "The request failed."),
      x.embedding ? "No embedding was returned." : "No answer was generated or cached.",
    ];
    return { verdict: "Request failed", tone: "error", steps };
  }

  if (x.embedding) return explainEmbedding(x.embedding, x.latencyMs, x.promptTokens);

  if (x.mode === "none") {
    return {
      verdict: "Cache bypassed: answered by Bedrock",
      tone: "off",
      steps: [
        "The app sent X-cb-cache: none, so the gateway neither looked up nor stored this answer.",
        `Bedrock generated it in ${fmtMs(x.latencyMs)} using ${tokens}, all billed.`,
      ],
    };
  }

  if (h["x-cb-cache-enabled"] === "false") {
    const why =
      x.mode === "semantic" && !embedding
        ? "No embedding model is attached for the semantic cache (x-cb-semantic-cache-embedding-model is empty)."
        : "Caching is off for this model, or the API key does not have the cache role.";
    return {
      verdict: "Cache disabled on the gateway: answered by Bedrock",
      tone: "off",
      steps: [
        `The app asked for the ${x.mode} cache, but the gateway reported x-cb-cache-enabled: false.`,
        why,
        `The request went straight to Bedrock (${fmtMs(x.latencyMs)}, ${tokens} billed) and nothing was stored.`,
      ],
    };
  }

  if (x.cacheHit) {
    const exact = x.mode === "standard" || (x.matchScore !== undefined && x.matchScore >= 0.9999);
    const steps = exact
        ? [
            (x.mode === "semantic" ? "Semantic mode tries an exact match first. " : "") +
              "The gateway hashed the whole request (SHA-256 of model, messages, parameters, system prompt, X-cb-attr-* attributes and the calling API key).",
            "An answer was already stored in Couchbase under that key, so it returned X-Cache: HIT.",
          ]
        : [
            "No answer was stored for this exact request, so the gateway embedded the last user message" +
              (embedding ? ` with ${embedding}` : "") +
              " and ran a vector search over cached answers with the same model, parameters, system prompt and caller.",
            x.matchScore !== undefined
              ? `The closest cached answer scored ${x.matchScore.toFixed(3)}${thr ? `, above the ${thr} threshold` : ", above the threshold"}, so it returned X-Cache: HIT.`
              : "A cached answer scored above the similarity threshold, so it returned X-Cache: HIT. (Send X-cb-debug: true to see the score.)",
          ];
    if (scope) steps.push(scope);
    steps.push(`Bedrock was not called. The answer came back in ${fmtMs(x.latencyMs)}; the ${tokens} in usage belong to the original answer and were not billed again.`);
    const verdict = exact ? "Cache hit: exact match" : x.matchScore !== undefined ? "Cache hit: similar question" : "Cache hit";
    return { verdict, tone: "hit", steps };
  }

  const steps =
    x.mode === "standard"
      ? ["No answer is stored under this request's exact hash. Any change in wording, conversation history, attributes or system prompt gives a new key."]
      : [
          "No exact match, and no cached answer was similar enough" + (thr ? ` (similarity threshold ${thr})` : "") + ".",
        ];
  if (scope) steps.push(scope);
  steps.push(`The gateway forwarded the request to Bedrock: ${fmtMs(x.latencyMs)}, ${tokens} billed.`);
  steps.push(
    `The gateway then writes the answer${x.mode === "semantic" ? " and its embedding" : ""} to Couchbase${expiry ? ` for ${expiry}` : ""}, so ${x.mode === "semantic" ? "the same or a similar question" : "an identical request"} should be served from the cache. The response does not confirm that the write succeeded.`,
  );
  if (x.repeatMiss) {
    steps.push(
      "Warning: this exact question already went through the cache earlier in this session, so it should have been a hit. The earlier answer was not stored: the gateway's cache write is failing. Check the gateway logs for \"error setting chat completion cache\" and the cache bucket's permissions.",
    );
  }
  if (!h["x-cache"]) steps.push("The gateway sends no X-Cache header on a miss.");
  if (!debugOn) steps.push("Debug headers are off (CMS_DEBUG=false), so cache settings and match scores are not shown.");
  return { verdict: "Cache miss: answered by Bedrock", tone: "miss", steps };
}

function explainEmbedding(e: EmbeddingInfo, latencyMs: number, promptTokens: number): Explanation {
  const steps = [
    `${e.model} is an embedding model, so the app called POST /v1/embeddings instead of /v1/chat/completions.`,
    `The gateway returned a ${e.dimensions.toLocaleString()}-dimension vector in ${fmtMs(latencyMs)}; ${promptTokens.toLocaleString()} input tokens billed.`,
    "The gateway does not cache embeddings, so the app sends no X-cb-cache header and every call reaches the model.",
    "The semantic cache uses vectors like this one: it embeds the last user message and compares it with the embeddings of cached answers. A score above the threshold is a hit.",
  ];
  const top = e.nearest?.[0];
  if (top) steps.push(`Closest earlier question in this conversation: "${top.question}", cosine similarity ${top.score.toFixed(3)}.`);
  return { verdict: "Embedding: not cached", tone: "off", steps };
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function statusHint(status: number) {
  if (status === 401 || status === 403) return "Check the API key in Connection settings.";
  if (status === 404) return "The model name may be wrong; pick one from the list in Connection settings.";
  if (status === 429) return "The gateway is rate limiting this key.";
  if (status >= 500) return "The gateway or Bedrock had an error.";
  return "";
}

/** A copy-pasteable curl for the traced request, with the key left as $CMS_API_KEY. */
export function toCurl(trace: Trace): string {
  const lines = [`curl -sS -X ${trace.request.method} '${trace.request.url}'`];
  for (const [k, v] of Object.entries(trace.request.headers)) {
    lines.push(k.toLowerCase() === "authorization" ? `-H "Authorization: Bearer $CMS_API_KEY"` : `-H '${k}: ${v}'`);
  }
  lines.push(`-d '${JSON.stringify(trace.request.body).replace(/'/g, "'\\''")}'`);
  return lines.join(" \\\n  ");
}
