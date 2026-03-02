export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; backoffMs?: number } = {},
): Promise<T> {
  const { maxRetries = 3, backoffMs = 1000 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, backoffMs * Math.pow(2, attempt)),
        );
      }
    }
  }
  throw lastError;
}
