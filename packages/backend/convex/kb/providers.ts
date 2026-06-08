/**
 * Provider availability + callback wiring for scraper/parser backends.
 * The frontend reads getScraperAvailability to enable/disable the Tarser toggle.
 */
import { env } from "../env"
import { isTarserAvailable } from "../config"
import { tenantQuery } from "../lib/auth/tenant"

export const getScraperAvailability = tenantQuery({
  args: {},
  handler: async () => {
    return { tarser: isTarserAvailable() }
  }
})

/**
 * Build the Tarser callback URL for a job. Prefers TARSER_CALLBACK_BASE_URL (local dev,
 * e.g. http://host.docker.internal:<port>), else CONVEX_SITE_URL (the deployment .convex.site).
 * Server-only helper used by submit actions — NOT a Convex function.
 */
export function tarserCallbackUrl(jobId: string, token: string): string {
  const base =
    env.TARSER_CALLBACK_BASE_URL ?? process.env.CONVEX_SITE_URL ?? ""
  if (!base) throw new Error("No callback base URL: set TARSER_CALLBACK_BASE_URL or CONVEX_SITE_URL")
  return `${base.replace(/\/+$/, "")}/tarser/cb?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token)}`
}
