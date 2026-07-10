import { isRetryableHttpStatus, type RetryOptions, withRetry } from "./retry.js"

/** Error carrying the HTTP status so retry policy can discriminate 4xx vs 5xx. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * Thrown when a request exceeds its own `timeoutMs` and is aborted. Kept
 * distinct from a transient network error so the retry policy can fail fast:
 * re-running the same call only re-aborts at the same deadline, burning the
 * backoff schedule without any chance of success.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TimeoutError"
  }
}

/** AbortError is a DOMException, not necessarily an Error subclass; match by name. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  )
}

/** Default retry predicate: transient HTTP failures only (see isRetryableHttpStatus). */
function defaultShouldRetry(error: unknown): boolean {
  // A self-induced timeout will only time out again on retry; fail fast.
  if (error instanceof TimeoutError) return false
  return isRetryableHttpStatus(
    error instanceof HttpError ? error.status : undefined
  )
}

/**
 * Options for {@link requestJSON}.
 */
export interface RequestJSONOptions {
  /** Full endpoint URL. */
  readonly url: string

  /** HTTP method. @default "POST" */
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

  /** JSON-serialisable body; omitted entirely when undefined (bodyless methods). */
  readonly body?: unknown

  /** Headers merged on top of the default `Content-Type: application/json`. */
  readonly headers?: Readonly<Record<string, string>>

  /** Human-readable provider name used in the default error message. */
  readonly provider: string

  /**
   * Retry configuration forwarded to {@link withRetry}. `shouldRetry` defaults
   * to the standard HTTP policy (transient failures only). Set `maxRetries: 0`
   * to disable retries.
   */
  readonly retry?: RetryOptions

  /** Per-request timeout in ms; aborts a hung fetch so withRetry can retry. */
  readonly timeoutMs?: number

  /**
   * Redirect policy forwarded to fetch; defaults to the platform "follow".
   * Pass "error" for endpoints that must never redirect: fetch strips
   * `Authorization` on cross-origin redirects but preserves custom auth
   * headers (e.g. `api-key`), which would otherwise follow the redirect.
   */
  readonly redirect?: "follow" | "error" | "manual"

  /**
   * Build the error thrown on a non-2xx response. Defaults to an {@link HttpError}
   * with a `${provider} API error: ...` message. Provide a custom factory to
   * throw a provider-specific subclass (e.g. for `instanceof` checks).
   */
  readonly errorFactory?: (
    status: number,
    statusText: string,
    bodyText: string
  ) => Error
}

/**
 * Core HTTP-JSON request with retry + timeout. The single fetch/retry seam
 * shared by {@link postJSON} and the Qdrant vector store, so both packages
 * behave identically (retry policy, timeout, error shape) and a future move to
 * a vendor SDK is a localized swap.
 *
 * - Serialises `body` as JSON with the correct content-type header.
 * - Merges any extra `headers` (e.g. Authorization / api-key) on top.
 * - Wraps the call in {@link withRetry}; non-retryable 4xx fail fast.
 * - On non-2xx, throws via `errorFactory` (carrying the HTTP status).
 */
export async function requestJSON<T>(options: RequestJSONOptions): Promise<T> {
  const {
    url,
    method = "POST",
    body,
    headers = {},
    provider,
    retry,
    timeoutMs,
    redirect,
    errorFactory = (status, statusText, text) =>
      new HttpError(
        status,
        `${provider} API error: ${status} ${statusText} — ${text}`
      )
  } = options

  return withRetry(
    async () => {
      const controller =
        timeoutMs !== undefined ? new AbortController() : undefined
      let timedOut = false
      const timer = controller
        ? setTimeout(() => {
            timedOut = true
            controller.abort()
          }, timeoutMs)
        : undefined
      try {
        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller?.signal,
          redirect
        })

        if (!response.ok) {
          const text = await response.text()
          throw errorFactory(response.status, response.statusText, text)
        }

        return (await response.json()) as T
      } catch (err) {
        // Surface our own timeout abort as a TimeoutError so defaultShouldRetry
        // fails fast instead of re-aborting at the same deadline three times.
        if (timedOut && isAbortError(err)) {
          throw new TimeoutError(
            `${provider} request timed out after ${timeoutMs}ms`
          )
        }
        throw err
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    },
    {
      maxRetries: retry?.maxRetries,
      backoffMs: retry?.backoffMs,
      shouldRetry: retry?.shouldRetry ?? defaultShouldRetry
    }
  )
}

/**
 * Options for {@link postJSON}.
 */
export interface PostJSONOptions {
  /** Full endpoint URL. */
  readonly url: string

  /** JSON-serialisable request body. */
  readonly body: unknown

  /**
   * Human-readable provider name used in error messages
   * (e.g. "Voyage", "Jina Rerank").
   */
  readonly provider: string

  /**
   * HTTP headers merged on top of the default `Content-Type: application/json`.
   *
   * Typically used for auth:
   * ```ts
   * headers: { Authorization: `Bearer ${apiKey}` }
   * ```
   */
  readonly headers?: Readonly<Record<string, string>>

  /**
   * Retry configuration forwarded to {@link withRetry}.
   * Set `maxRetries: 0` to disable retries.
   */
  readonly retry?: { maxRetries?: number; backoffMs?: number }

  /**
   * Per-request timeout in ms; aborts a hung fetch so a wedged provider call
   * cannot stack retries and starve the concurrency pool. Defaults to 120000 —
   * high enough that a large embedding/rerank batch is not aborted mid-flight,
   * while still bounding a genuinely wedged connection.
   */
  readonly timeoutMs?: number
}

/**
 * Default per-request timeout for {@link postJSON} (ms). Sized for the slow
 * path (large embedding/rerank batches over HTTP), not the typical call; a
 * self-induced timeout is not retried (see {@link TimeoutError}).
 */
const DEFAULT_POST_TIMEOUT_MS = 120_000

/**
 * POST a JSON payload to an API endpoint and return the parsed response. Thin
 * wrapper over {@link requestJSON} for the common authenticated-POST case.
 *
 * On non-2xx responses, throws an {@link HttpError} that includes the provider
 * name, HTTP status, and the raw response body for debuggability. Non-retryable
 * 4xx (e.g. a bad API key) fail fast instead of burning the backoff schedule.
 *
 * Every request carries a timeout (default 120000ms) so a hung provider
 * (embed/rerank over HTTP) aborts instead of holding a concurrency slot open;
 * a timeout fails fast rather than retrying into the same deadline.
 */
export async function postJSON<T>(options: PostJSONOptions): Promise<T> {
  return requestJSON<T>({
    timeoutMs: DEFAULT_POST_TIMEOUT_MS,
    ...options,
    method: "POST"
  })
}
