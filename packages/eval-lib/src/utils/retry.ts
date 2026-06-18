export interface RetryOptions {
  maxRetries?: number
  backoffMs?: number
  /**
   * Predicate deciding whether a thrown error is worth retrying. Defaults to
   * retrying every error. Return false to fail fast (e.g. a non-retryable 4xx
   * such as a bad API key) instead of burning the full backoff schedule.
   */
  shouldRetry?: (error: unknown) => boolean
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, backoffMs = 1000, shouldRetry } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (shouldRetry && !shouldRetry(error)) throw error
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, backoffMs * 2 ** attempt)
        )
      }
    }
  }
  throw lastError
}

/**
 * Standard HTTP retry policy. Transient conditions are worth retrying;
 * deterministic client errors are not:
 * - `undefined` (network error, timeout, abort): transient -> retry
 * - 408 (request timeout) and 429 (rate limited): retry
 * - 5xx (server error): retry
 * - every other 4xx (bad key, bad request, not found): never succeeds on
 *   retry -> fail fast
 */
export function isRetryableHttpStatus(status: number | undefined): boolean {
  if (status === undefined) return true
  if (status === 408 || status === 429) return true
  return status >= 500
}
