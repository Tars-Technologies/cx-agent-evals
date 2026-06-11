/**
 * Replay-protection nonces for Tarser callbacks. A nonce is claimed before a
 * callback is applied; Convex mutations are serializable, so the query+insert
 * in claimNonce is an atomic first-writer-wins claim.
 */
import { v } from "convex/values"
import { internalMutation } from "../_generated/server"

const NONCE_TTL_MS = 24 * 60 * 60 * 1000
const REAP_BATCH = 500

export const claimNonce = internalMutation({
  args: { nonce: v.string(), serviceJobId: v.string() },
  handler: async (ctx, args): Promise<{ firstSeen: boolean }> => {
    const existing = await ctx.db
      .query("tarserCallbackNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .first()
    if (existing) return { firstSeen: false }
    await ctx.db.insert("tarserCallbackNonces", {
      nonce: args.nonce,
      serviceJobId: args.serviceJobId,
      claimedAt: Date.now()
    })
    return { firstSeen: true }
  }
})

/** Undo a claim after a failed dispatch so the sender's retry re-applies. */
export const releaseNonce = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tarserCallbackNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .first()
    if (existing) await ctx.db.delete(existing._id)
  }
})

/** Nonces older than the signature timestamp window are useless; reap daily-old
 * rows in bounded batches (overflow is swept on the next cron tick). */
export const reapStaleNonces = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NONCE_TTL_MS
    const rows = await ctx.db.query("tarserCallbackNonces").take(REAP_BATCH)
    let reaped = 0
    for (const row of rows) {
      if (row.claimedAt >= cutoff) continue
      await ctx.db.delete(row._id)
      reaped++
    }
    return { reaped }
  }
})
