/**
 * Provider availability + callback wiring for scraper/parser backends.
 * The frontend reads getScraperAvailability to enable/disable the Tarser toggle.
 */

import {
  isAsimovAvailable,
  isTarserAvailable,
  providerKeyAvailability
} from "../config"
import { env } from "../env"
import { tenantQuery } from "../lib/auth/tenant"

export const getScraperAvailability = tenantQuery({
  args: {},
  handler: async () => {
    return { tarser: isTarserAvailable(), asimov: isAsimovAvailable() }
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
// Asimov poll cadence, shared by the crawl and parse poll actions. The per-attempt
// deadline is kept under the Convex ~10-min action kill so getResult returns control
// (result or JobNotReadyError) before the runtime force-terminates the action; the
// polling/normalization policy itself stays in eval-lib (see proposal §10).
export const ASIMOV_POLL_DEADLINE_MS = 8 * 60 * 1000
export const ASIMOV_REPOLL_DELAY_MS = 5_000

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
