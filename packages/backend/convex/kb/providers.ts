/**
 * Provider availability + callback wiring for scraper/parser backends.
 * The frontend reads getScraperAvailability to enable/disable the Tarser toggle.
 */

import { isTarserAvailable, providerKeyAvailability } from "../config"
import { env } from "../env"
import { tenantQuery } from "../lib/auth/tenant"

export const getScraperAvailability = tenantQuery({
  args: {},
  handler: async () => {
    return { tarser: isTarserAvailable() }
  }
})

/**
 * Which embedder/reranker providers have an API key configured on the backend.
 * Keyed by registry provider id (openai, openrouter, cohere, jina, voyage).
 * The retriever wizard reads this to disable choices that would fail at runtime.
 */
export const getProviderAvailability = tenantQuery({
  args: {},
  handler: async () => providerKeyAvailability()
})

/**
 * Build the Tarser callback URL for a job. Prefers TARSER_CALLBACK_BASE_URL (local dev,
 * e.g. http://host.docker.internal:<port>), else CONVEX_SITE_URL (the deployment .convex.site).
 * Server-only helper used by submit actions — NOT a Convex function.
 */
export function tarserCallbackUrl(token: string): string {
  const base = env.TARSER_CALLBACK_BASE_URL ?? process.env.CONVEX_SITE_URL ?? ""
  if (!base)
    throw new Error(
      "No callback base URL: set TARSER_CALLBACK_BASE_URL or CONVEX_SITE_URL"
    )
  // Only the token rides on the URL; the job id comes back in the
  // X-Tarser-Job-Id header, so passing it here was dead/confusing.
  return `${base.replace(/\/+$/, "")}/tarser/cb?token=${encodeURIComponent(token)}`
}
