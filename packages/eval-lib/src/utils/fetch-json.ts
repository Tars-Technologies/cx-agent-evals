import { withRetry } from "./retry.js";

/**
 * Options for {@link postJSON}.
 */
export interface PostJSONOptions {
  /** Full endpoint URL. */
  readonly url: string;

  /** JSON-serialisable request body. */
  readonly body: unknown;

  /**
   * Human-readable provider name used in error messages
   * (e.g. "Voyage", "Jina Rerank").
   */
  readonly provider: string;

  /**
   * HTTP headers merged on top of the default `Content-Type: application/json`.
   *
   * Typically used for auth:
   * ```ts
   * headers: { Authorization: `Bearer ${apiKey}` }
   * ```
   */
  readonly headers?: Readonly<Record<string, string>>;

  /**
   * Retry configuration forwarded to {@link withRetry}.
   * Set `maxRetries: 0` to disable retries.
   */
  readonly retry?: { maxRetries?: number; backoffMs?: number };
}

/**
 * POST a JSON payload to an API endpoint and return the parsed response.
 *
 * - Serialises `body` as JSON with the correct content-type header.
 * - Merges any extra `headers` (e.g. Authorization) on top.
 * - Wraps the network call in {@link withRetry} for transient-failure resilience.
 * - On non-2xx responses, throws an `Error` that includes the provider name,
 *   HTTP status, and the raw response body for debuggability.
 */
export async function postJSON<T>(options: PostJSONOptions): Promise<T> {
  const { url, body, provider, headers = {}, retry } = options;

  return withRetry(async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `${provider} API error: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    return (await response.json()) as T;
  }, retry);
}
