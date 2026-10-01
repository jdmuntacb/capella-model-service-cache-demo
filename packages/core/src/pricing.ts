// Per-token prices used for the "$ saved" estimate.
// Defaults are Anthropic list prices for Claude Sonnet 5.5 (USD per 1M tokens).
// Claude on Amazon Bedrock is billed by AWS at its own rates
// (https://aws.amazon.com/bedrock/pricing/), and Capella may price differently,
// so override with PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK for real numbers.
export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
  source: string;
}

export const DEFAULT_PRICING: Pricing = {
  inputPerMTok: 2.0,
  outputPerMTok: 10.0,
  source: "Claude Sonnet 5.5 list price (Anthropic, 2026-09)",
};

export function pricingFromEnv(env: Record<string, string | undefined> = process.env): Pricing {
  const input = Number(env.PRICE_INPUT_PER_MTOK);
  const output = Number(env.PRICE_OUTPUT_PER_MTOK);
  if (input > 0 && output > 0) {
    return { inputPerMTok: input, outputPerMTok: output, source: "PRICE_*_PER_MTOK env override" };
  }
  return DEFAULT_PRICING;
}

export function costUSD(promptTokens: number, completionTokens: number, p: Pricing): number {
  return (promptTokens * p.inputPerMTok + completionTokens * p.outputPerMTok) / 1_000_000;
}
