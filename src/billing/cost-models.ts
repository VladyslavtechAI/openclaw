/**
 * Cost models for LLM API pricing.
 * Prices in USD per 1M tokens, updated March 2026.
 */

export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
};

/** Known model pricing (USD per 1M tokens). */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-6": { inputPerMillion: 15, outputPerMillion: 75, cachedInputPerMillion: 1.5 },
  "claude-sonnet-4-5": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  "claude-haiku-3-5": { inputPerMillion: 0.8, outputPerMillion: 4, cachedInputPerMillion: 0.08 },

  // OpenAI
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8, cachedInputPerMillion: 0.5 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "o3": { inputPerMillion: 10, outputPerMillion: 40 },
  "o3-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4 },

  // Google
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.6 },

  // Free / Local
  "ollama/*": { inputPerMillion: 0, outputPerMillion: 0 },
};

/**
 * Normalize model name for pricing lookup.
 * Strips provider prefix (anthropic/, openai/, etc.)
 */
function normalizeModelName(model: string): string {
  // Remove provider prefix
  const parts = model.split("/");
  const name = parts.length > 1 ? parts.slice(1).join("/") : model;
  return name.toLowerCase();
}

/**
 * Get pricing for a model. Returns zero pricing for unknown models.
 */
export function getModelPricing(model: string): ModelPricing {
  const normalized = normalizeModelName(model);

  // Exact match
  if (MODEL_PRICING[normalized]) {
    return MODEL_PRICING[normalized];
  }

  // Partial match (e.g., "claude-opus-4-6-20260315" -> "claude-opus-4-6")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalized.startsWith(key)) {
      return pricing;
    }
  }

  // Wildcard match (e.g., "ollama/qwen3:32b" -> "ollama/*")
  const provider = model.split("/")[0];
  const wildcardKey = `${provider}/*`;
  if (MODEL_PRICING[wildcardKey]) {
    return MODEL_PRICING[wildcardKey];
  }

  // Unknown model — return zero (safe default)
  return { inputPerMillion: 0, outputPerMillion: 0 };
}

/**
 * Calculate cost for a request.
 */
export function calculateRequestCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const pricing = getModelPricing(model);
  const nonCachedInput = inputTokens - cachedInputTokens;

  const inputCost = (nonCachedInput / 1_000_000) * pricing.inputPerMillion;
  const cachedCost = pricing.cachedInputPerMillion
    ? (cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion
    : 0;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return inputCost + cachedCost + outputCost;
}
