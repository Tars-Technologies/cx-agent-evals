import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// One-time prod-cutover cleanup for the agents/evaluator rehaul.
//
// These tables were REPURPOSED between `main` and this branch (different required
// fields), so rows written under `main` cannot satisfy the new strict schema. We
// clear those obsolete legacy rows rather than permanently loosening the schema
// (decision "b"; see docs/prod-deploy-runbook.md).
//
// A row is "legacy" iff it is missing this branch's new required key:
//   annotations / failureModes -> errorAnalysisId
//   evaluators / conversationScenarios / scenarioGenJobs -> agentId
//   conversationSimulations -> scenarioSetId
//
// Legacy rows are the OLDEST in each table (written under main), so they sort
// first and are reached before any new rows. clearLegacy deletes ONLY legacy rows
// (safe to re-run; never touches new data) and self-reschedules in bounded batches.

const BATCH = 200;

const TARGETS = [
  { table: "annotations", newKey: "errorAnalysisId" },
  { table: "failureModes", newKey: "errorAnalysisId" },
  { table: "evaluators", newKey: "agentId" },
  { table: "conversationScenarios", newKey: "agentId" },
  { table: "conversationSimulations", newKey: "scenarioSetId" },
  { table: "scenarioGenJobs", newKey: "agentId" },
] as const;

type LegacyTable = (typeof TARGETS)[number]["table"];

/**
 * Dry-run inspection: how many legacy (schema-incompatible) rows exist per table.
 * Read-only. Must be run with schemaValidation temporarily disabled (legacy rows
 * would otherwise fail read validation under the strict schema). See runbook.
 */
export const countLegacy = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10000 }) => {
    const count = async (table: LegacyTable, key: string) => {
      const rows = await ctx.db.query(table).take(limit);
      const legacy = rows.filter(
        (r) => (r as Record<string, unknown>)[key] === undefined,
      ).length;
      return { scanned: rows.length, legacy, capped: rows.length === limit };
    };
    const out: Record<string, { scanned: number; legacy: number; capped: boolean }> = {};
    for (const { table, newKey } of TARGETS) out[table] = await count(table, newKey);
    return out;
  },
});

/**
 * Delete legacy rows in bounded batches, self-rescheduling until none remain.
 * Run with schemaValidation temporarily disabled during the prod cutover.
 */
export const clearLegacy = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    for (const { table, newKey } of TARGETS) {
      const batch = await ctx.db.query(table).take(BATCH);
      for (const r of batch) {
        if ((r as Record<string, unknown>)[newKey] === undefined) {
          await ctx.db.delete(r._id);
          deleted++;
        }
      }
    }
    // Reschedule only while we are still deleting; a pass that deletes nothing
    // means every legacy row is gone (new rows are never deleted and never
    // trigger a reschedule), so the loop terminates.
    if (deleted > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.clearLegacyEvalRows.clearLegacy,
        {},
      );
    }
    return { deletedThisPass: deleted };
  },
});
