import { v } from "convex/values"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { internalAction } from "../_generated/server"

/**
 * Backfills `documentCount` on every KB that lacks it. Paginates document
 * scans to stay under the 16MB per-mutation read limit.
 *
 * Run from the Convex dashboard or CLI:
 *   npx convex run crud/knowledgeBasesActions:backfillDocumentCounts
 */
export const backfillDocumentCounts = internalAction({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ kbs: number; updated: number }> => {
    const kbIds: Id<"knowledgeBases">[] = await ctx.runQuery(
      internal.kb.core.listKbsMissingCount,
      {}
    )

    let updated = 0
    for (const kbId of kbIds) {
      let cursor: string | null = null
      let count = 0
      while (true) {
        const res: {
          done: boolean
          processedDelta: number
          cursor: string | null
        } = await ctx.runMutation(internal.kb.core.backfillOneKb, {
          kbId,
          cursor,
          batchSize: args.batchSize ?? 100
        })
        count += res.processedDelta
        cursor = res.cursor
        if (res.done) break
      }
      await ctx.runMutation(internal.kb.core.setDocumentCount, {
        kbId,
        count
      })
      updated++
    }

    return { kbs: kbIds.length, updated }
  }
})
