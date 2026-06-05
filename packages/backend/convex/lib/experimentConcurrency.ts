/**
 * Resolve the LangSmith evaluate() concurrency for an experiment run.
 *
 * Reads an optional override (env var) and clamps it into a safe range.
 * Pure and side-effect-free so it can be unit-tested without the action.
 */
export const DEFAULT_EXPERIMENT_CONCURRENCY = 3
export const MIN_EXPERIMENT_CONCURRENCY = 1
export const MAX_EXPERIMENT_CONCURRENCY = 10

export function resolveMaxConcurrency(
  raw: string | number | undefined
): number {
  if (typeof raw === "string" && raw.trim() === "") {
    return DEFAULT_EXPERIMENT_CONCURRENCY
  }
  const parsed = typeof raw === "string" ? Number(raw) : raw
  if (parsed === undefined || !Number.isFinite(parsed)) {
    return DEFAULT_EXPERIMENT_CONCURRENCY
  }
  const floored = Math.floor(parsed)
  if (floored < MIN_EXPERIMENT_CONCURRENCY) return MIN_EXPERIMENT_CONCURRENCY
  if (floored > MAX_EXPERIMENT_CONCURRENCY) return MAX_EXPERIMENT_CONCURRENCY
  return floored
}
