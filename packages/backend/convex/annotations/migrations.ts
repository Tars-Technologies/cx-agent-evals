import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * One-time migration: convert legacy ratings to pass/fail.
 * great, good_enough → pass; bad → fail.
 * Run from Convex dashboard: internal.annotations.migrations.migrateRatings
 */
export const migrateRatings = internalMutation({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    const result = await ctx.db
      .query("annotations")
      .paginate({ numItems: batchSize, cursor: args.cursor ?? null });

    let migrated = 0;
    for (const annotation of result.page) {
      if (
        annotation.rating === "great" ||
        annotation.rating === "good_enough"
      ) {
        await ctx.db.patch(annotation._id, { rating: "pass" });
        migrated++;
      } else if (annotation.rating === "bad") {
        await ctx.db.patch(annotation._id, { rating: "fail" });
        migrated++;
      }
    }

    return {
      migrated,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});
