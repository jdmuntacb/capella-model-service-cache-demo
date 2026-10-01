// Header names used by Capella Model Service (AI Gateway).
// Source: ai-gateway pkg/common/constants.go.
export const HEADERS = {
  cacheType: "X-cb-cache", // none | standard | semantic
  cacheThreshold: "X-cb-cache-threshold", // semantic similarity override (0..1)
  cacheExpiryDuration: "X-cb-cache-expiry-duration", // seconds
  attributePrefix: "X-cb-attr-", // e.g. X-cb-attr-topic: <conversation id>
  debug: "X-cb-debug",
  // response
  cacheHit: "X-Cache", // HIT | MISS
  matchScore: "X-cb-match-score", // only with X-cb-debug: true
  cacheTypeUsed: "X-cb-cache-type",
  cacheEnabled: "X-cb-cache-enabled",
} as const;

export type CacheMode = "none" | "standard" | "semantic";
export const CACHE_MODES: CacheMode[] = ["none", "standard", "semantic"];
