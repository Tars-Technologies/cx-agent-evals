"use node"

/**
 * Tarser callback handler. Verifies the HMAC signature, normalizes the snake_case
 * event, and dispatches to the crawl/parse handlers. Lives in a "use node" action
 * because it imports the eval-lib scraper module (node-only transitive deps).
 */
import {
  PythonContentService,
  verifyCallbackSignature
} from "@tars-inc/eval-lib/scraper"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { env } from "../env"

export const handleTarserCallback = internalAction({
  args: {
    token: v.string(),
    jobId: v.string(),
    signature: v.string(),
    body: v.any()
  },
  handler: async (ctx, args): Promise<{ status: number }> => {
    const secret = env.TARSER_CALLBACK_HMAC_SECRET
    if (!secret) return { status: 503 }

    const ok = await verifyCallbackSignature({
      jobId: args.jobId,
      token: args.token,
      secret,
      signature: args.signature
    })
    if (!ok) return { status: 401 }

    const cb = PythonContentService.normalizeCallback(
      args.body as Record<string, unknown>
    )

    // The body's service_job_id must match the signed job id, else a valid signed
    // envelope could be replayed with a different body job id.
    if (cb.kind !== "ignored" && cb.serviceJobId !== args.jobId) {
      return { status: 401 }
    }

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
      if (cb.kind === "page") {
        await ctx.runMutation(internal.kb.crawl.handleTarserPage, {
          crawlJobId: job._id,
          url: cb.url,
          title: cb.title ?? cb.url,
          markdown: cb.markdown
        })
      } else if (cb.kind === "job_complete") {
        await ctx.runMutation(internal.kb.crawl.handleTarserJobComplete, {
          crawlJobId: job._id,
          finishReason: cb.finishReason,
          stats: cb.stats
        })
      }
      // page_failed / discovered_file: acked no-op in v1.
      return { status: 200 }
    }

    if (cb.kind === "parsed") {
      await ctx.runMutation(internal.kb.documents.finishParse, {
        parseServiceJobId: cb.serviceJobId,
        status: cb.status,
        markdown: cb.markdown,
        error: cb.error
      })
      return { status: 200 }
    }

    return { status: 200 } // ignored
  }
})
