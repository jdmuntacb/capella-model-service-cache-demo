import type { CacheMode } from "@demo/core";

/** Semantic mode also serves exact repeats, so label by the mode plus the reported similarity. */
export function hitLabel(mode: CacheMode, score?: number) {
  if (mode !== "semantic") return "exact match";
  return score !== undefined ? `similarity ${score.toFixed(2)}` : "semantic";
}
