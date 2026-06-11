"use node"

/**
 * Tarser callback handler. Verifies the timestamp window and body-binding HMAC
 * signature, claims the replay nonce, normalizes the snake_case event, and
 * dispatches to the crawl/parse handlers. Lives in a "use node" action because
 * it imports the eval-lib scraper module (node-only transitive deps).
 */
import {
  computeBodyHash,
  PythonContentService,
  verifyCallbackSignature
} from "@tars-inc/eval-lib/scraper"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { env } from "../env"

const TIMESTAMP_WINDOW_S = 300

export const handleTarserCallback = internalAction({
  args: {
    token: v.string(),
    jobId: v.string(),
    signature: v.string(),
    timestamp: v.string(),
    nonce: v.string(),
    rawBody: v.string()
  },
  handler: async (ctx, args): Promise<{ status: number }> => {
    const secret = env.TARSER_CALLBACK_HMAC_SECRET
    if (!secret) return { status: 503 }

    // Reject anything outside the replay window before touching the body.
    if (!/^\d+$/.test(args.timestamp)) return { status: 401 }
    const ts = Number.parseInt(args.timestamp, 10)
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TIMESTAMP_WINDOW_S) {
      return { status: 401 }
    }

    // The signature binds job id, token, timestamp, nonce, and the exact body
    // bytes, so a valid envelope cannot be replayed with a different payload.
    const bodyHash = await computeBodyHash(args.rawBody)
    const ok = await verifyCallbackSignature({
      serviceJobId: args.jobId,
      token: args.token,
      timestamp: args.timestamp,
      nonce: args.nonce,
      bodyHash,
      secret,
      signature: args.signature
    })
    if (!ok) return { status: 401 }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(args.rawBody) as Record<string, unknown>
    } catch {
      return { status: 400 }
    }
    const cb = PythonContentService.normalizeCallback(parsed)

    // The body's service_job_id must match the signed job id, else a valid signed
    // envelope could be replayed with a different body job id.
    if (cb.kind !== "ignored" && cb.serviceJobId !== args.jobId) {
      return { status: 401 }
    }

    // Atomic nonce claim: a replayed nonce is acked but never re-applied. On a
    // dispatch failure the nonce is released so the sender's retry re-applies.
    const claimNonce = () =>
      ctx.runMutation(internal.kb.tarser_nonce.claimNonce, {
        nonce: args.nonce,
        serviceJobId: args.jobId
      })
    const releaseNonce = () =>
      ctx.runMutation(internal.kb.tarser_nonce.releaseNonce, {
        nonce: args.nonce
      })

    if (
      cb.kind === "page" ||
      cb.kind === "page_failed" ||
      cb.kind === "job_complete" ||
      cb.kind === "discovered_file"
    ) {
      const job = await ctx.runQuery(internal.kb.crawl.getJobByServiceJob, {
        serviceJobId: cb.serviceJobId
      })
      if (!job) return { status: 200 } // ack; nothing to correlate
      // Defense-in-depth: the request token must match the per-job token we
      // stored (the global HMAC secret alone otherwise gates every job).
      if (job.callbackToken && job.callbackToken !== args.token) {
        return { status: 401 }
      }
      const { firstSeen } = await claimNonce()
      if (!firstSeen) return { status: 200 } // replay: idempotent ack
      try {
        if (cb.kind === "page") {
          await ctx.runMutation(internal.kb.crawl.handleTarserPage, {
            crawlJobId: job._id,
            url: cb.url,
            title: cb.title ?? cb.url,
            markdown: cb.markdown
          })
        } else if (cb.kind === "page_failed") {
          await ctx.runMutation(internal.kb.crawl.handleTarserPageFailed, {
            crawlJobId: job._id,
            url: cb.url,
            error: cb.error
          })
        } else if (cb.kind === "job_complete") {
          await ctx.runMutation(internal.kb.crawl.handleTarserJobComplete, {
            crawlJobId: job._id,
            finishReason: cb.finishReason,
            stats: cb.stats
          })
        }
        // discovered_file: acked no-op in v1.
      } catch (err) {
        await releaseNonce()
        throw err
      }
      return { status: 200 }
    }

    if (cb.kind === "parsed") {
      const parseToken = await ctx.runQuery(
        internal.kb.documents.getParseTokenByServiceJob,
        { parseServiceJobId: cb.serviceJobId }
      )
      if (parseToken && parseToken !== args.token) {
        return { status: 401 }
      }
      const { firstSeen } = await claimNonce()
      if (!firstSeen) return { status: 200 } // replay: idempotent ack
      try {
        await ctx.runMutation(internal.kb.documents.finishParse, {
          parseServiceJobId: cb.serviceJobId,
          status: cb.status,
          markdown: cb.markdown,
          error: cb.error
        })
      } catch (err) {
        await releaseNonce()
        throw err
      }
      return { status: 200 }
    }

    return { status: 200 } // ignored
  }
})
