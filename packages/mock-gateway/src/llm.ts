// Simulated upstream model (Claude Sonnet on Bedrock). It returns helpdesk answers
// and takes as long as a real model would: time-to-first-token plus per-token
// generation time, so cache hits vs misses show realistic latency differences.
import { TOPICS, estimateTokens, findTopic, type Topic } from "@demo/core";
import { embed, similarity } from "./embed";
import type { ChatRequestBody } from "./cache";
import { lastUserMessage } from "./cache";

export interface LatencyProfile {
  /** Time to first token, ms. */
  ttftMs: number;
  /** Generation time per output token, ms (~55 tokens/s). */
  perTokenMs: number;
  /** +/- random jitter applied to the total, as a fraction. */
  jitter: number;
}

export const DEFAULT_LATENCY: LatencyProfile = { ttftMs: 650, perTokenMs: 18, jitter: 0.15 };

export interface Completion {
  content: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

function bestTopic(question: string): Topic | undefined {
  const exact = findTopic(question);
  if (exact) return exact;
  const q = embed(question);
  let best: Topic | undefined;
  let bestScore = 0;
  for (const t of TOPICS) {
    for (const text of [t.canonical, ...t.paraphrases]) {
      const s = similarity(q, embed(text));
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
  }
  return bestScore >= 0.5 ? best : undefined;
}

function genericAnswer(question: string): string {
  return `Thanks for asking about "${question.replace(/\?$/, "")}".

This isn't covered by a standard Acme policy article, so here's how to get a definitive answer:

1. Search **ServiceHub > Knowledge** for the latest policy page.
2. If nothing matches, open a ticket under *General Inquiry* - People Ops or IT will reply within 1 business day.
3. For anything urgent, call the Service Desk at x4357.

I've noted the question so the knowledge base team can add an article.`;
}

export function complete(body: ChatRequestBody, profile: LatencyProfile, rand: () => number = Math.random): Completion {
  const question = lastUserMessage(body);
  const topic = bestTopic(question);
  const content = topic ? topic.answer : genericAnswer(question);
  const promptTokens = body.messages.reduce((a, m) => a + estimateTokens(m.content) + 4, 3);
  const completionTokens = estimateTokens(content);
  const base = profile.ttftMs + completionTokens * profile.perTokenMs;
  const latencyMs = base * (1 + (rand() * 2 - 1) * profile.jitter);
  return { content, promptTokens, completionTokens, latencyMs };
}
