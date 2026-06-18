import { mutation, query, internalMutation } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import {
  Workpool,
  vOnCompleteArgs,
  type RunResult,
} from "@convex-dev/workpool";
import { getAuthContext } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

const pool = new Workpool(components.conversationGenPool, {
  maxParallelism: 1,
});

export const startGeneration = mutation({
  args: {
    agentId: v.id("agents"),
    kbId: v.optional(v.id("knowledgeBases")),
    transcriptUploadId: v.optional(v.id("livechatUploads")),
    count: v.optional(v.number()),
    model: v.optional(v.string()),
    complexityDistribution: v.optional(
      v.object({
        low: v.number(),
        medium: v.number(),
        high: v.number(),
      }),
    ),
    transcriptConversationIds: v.optional(
      v.array(v.id("livechatConversations")),
    ),
    // 0–100; % of scenarios that are grounded (require transcripts)
    distribution: v.optional(v.number()),
    // 0–100; high = stick close to source transcript
    fidelity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }

    if (!args.kbId && !args.transcriptUploadId) {
      throw new Error(
        "Must provide a knowledge base or a transcript upload",
      );
    }

    // Guard: only one active generation per agent at a time
    const running = await ctx.db
      .query("scenarioGenJobs")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "running"),
          q.eq(q.field("status"), "pending"),
        ),
      )
      .first();
    if (running) {
      throw new Error("A scenario generation is already in progress");
    }

    const count = Math.max(1, Math.min(100, args.count ?? 10));
    const transcriptUploadIds = args.transcriptUploadId
      ? [args.transcriptUploadId]
      : undefined;

    // Derive set source + auto-name
    const hasKb = !!args.kbId;
    const hasTranscripts =
      !!args.transcriptUploadId &&
      (args.transcriptConversationIds?.length ?? 0) > 0;
    const distributionPct = args.distribution ?? (hasTranscripts ? 50 : 0);
    const isMixed =
      hasKb && hasTranscripts && distributionPct > 0 && distributionPct < 100;
    const source: "synthetic" | "grounded" | "mixed" = isMixed
      ? "mixed"
      : hasTranscripts && distributionPct === 100
        ? "grounded"
        : "synthetic";
    const now = new Date();
    const setName = `${source[0].toUpperCase()}${source.slice(1)} – ${now.toLocaleString(
      "en-US",
      { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    )}`;

    // Create the set first (generationJobId patched after job insert).
    const scenarioSetId = await ctx.db.insert("scenarioSets", {
      orgId,
      agentId: args.agentId,
      name: setName,
      source,
      generationConfig: {
        kbId: args.kbId,
        transcriptUploadId: args.transcriptUploadId,
        transcriptConversationIds: args.transcriptConversationIds,
        targetCount: count,
        distribution: distributionPct,
        fidelity: args.fidelity,
        complexityDistribution: args.complexityDistribution,
        model: args.model,
      },
      scenarioCount: 0,
      createdAt: Date.now(),
    });

    // Insert the job, now that we have the set id.
    const jobId = await ctx.db.insert("scenarioGenJobs", {
      orgId,
      agentId: args.agentId,
      scenarioSetId,
      kbId: args.kbId,
      transcriptUploadId: args.transcriptUploadId,
      status: "running",
      targetCount: count,
      generatedCount: 0,
      createdAt: Date.now(),
      transcriptUploadIds,
      transcriptConversationIds: args.transcriptConversationIds,
      distribution: args.distribution,
      fidelity: args.fidelity,
    });

    // Patch the set with the now-known generationJobId.
    await ctx.db.patch(scenarioSetId, { generationJobId: jobId });

    await pool.enqueueAction(
      ctx,
      internal.conversationSim.generationActions.generateScenarios,
      {
        agentId: args.agentId,
        kbId: args.kbId,
        transcriptUploadId: args.transcriptUploadId,
        orgId,
        jobId,
        scenarioSetId,
        config: {
          count,
          model: args.model,
          complexityDistribution: args.complexityDistribution,
          transcriptConversationIds: args.transcriptConversationIds,
          distribution: args.distribution ?? 0,
          fidelity: args.fidelity ?? 100,
        },
      },
      {
        context: { jobId: jobId as string, scenarioSetId: scenarioSetId as string },
        onComplete: internal.conversationSim.generation.onGenerationComplete,
      },
    );

    return { started: true, jobId, scenarioSetId };
  },
});

export const updateProgress = internalMutation({
  args: {
    jobId: v.id("scenarioGenJobs"),
    generatedCount: v.number(),
  },
  handler: async (ctx, { jobId, generatedCount }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    await ctx.db.patch(jobId, { generatedCount });
  },
});

export const onGenerationComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({ jobId: v.string(), scenarioSetId: v.string() }),
  ),
  handler: async (
    ctx,
    {
      context,
      result,
    }: {
      workId: string;
      context: { jobId: string; scenarioSetId: string };
      result: RunResult;
    },
  ) => {
    const jobId = context.jobId as Id<"scenarioGenJobs">;
    const scenarioSetId = context.scenarioSetId as Id<"scenarioSets">;
    const job = await ctx.db.get(jobId);
    if (!job) return;

    if (result.kind === "success") {
      await ctx.db.patch(jobId, {
        status: "completed",
        completedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(jobId, {
        status: "failed",
        error:
          result.kind === "failed" ? result.error : "Generation cancelled",
        completedAt: Date.now(),
      });
    }

    // Update set count; if generation failed with zero scenarios, drop the
    // empty set so it doesn't clutter the UI.
    const scenarios = await ctx.db
      .query("conversationScenarios")
      .withIndex("by_set", (q) => q.eq("scenarioSetId", scenarioSetId))
      .collect();
    if (scenarios.length === 0 && result.kind !== "success") {
      await ctx.db.delete(scenarioSetId);
    } else {
      await ctx.db.patch(scenarioSetId, { scenarioCount: scenarios.length });
    }
  },
});

export const getActiveJob = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);

    const active = await ctx.db
      .query("scenarioGenJobs")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "running"),
          q.eq(q.field("status"), "pending"),
        ),
      )
      .first();
    if (!active || active.orgId !== orgId) return null;

    const THIRTY_MIN = 30 * 60 * 1000;
    if (Date.now() - active.createdAt > THIRTY_MIN) return null;
    return active;
  },
});

export const getJob = query({
  args: { jobId: v.id("scenarioGenJobs") },
  handler: async (ctx, { jobId }) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.orgId !== orgId) return null;
    return job;
  },
});
