/** Default LLM model for generation strategies */
export const DEFAULT_MODEL = "gpt-4o";

/**
 * Extract model name from strategy config, with default fallback.
 */
export function getModel(strategyConfig: Record<string, unknown>): string {
  return (strategyConfig.model as string) ?? DEFAULT_MODEL;
}
