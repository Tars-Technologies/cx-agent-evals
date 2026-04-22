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

// Reuse conversationSimPool — generation and simulation are low-traffic
const pool = new Workpool(components.conversationSimPool, {
  maxParallelism: 1, // Only 1 generation at a time
});

// ─── Start Generation ───

export const startGeneration = mutation({
  args: {
    datasetId: v.id("datasets"),
    count: v.optional(v.number()),
    model: v.optional(v.string()),
    complexityDistribution: v.optional(
      v.object({
        low: v.number(),
        medium: v.number(),
        high: v.number(),
      }),
    ),
    // Transcript & distribution config
    transcriptUploadIds: v.optional(v.array(v.id("livechatUploads"))),
    transcriptConversationIds: v.optional(v.array(v.id("livechatConversations"))),
    distribution: v.optional(v.number()),
    fidelity: v.optional(v.number()),
    kbId: v.optional(v.id("knowledgeBases")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId)
      throw new Error("Dataset not found");
    if (dataset.type !== "conversation_sim")
      throw new Error("Dataset must be conversation_sim type");

    // Guard: only one active generation per org at a time
    const running = await ctx.db
      .query("scenarioGenJobs")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "running"))
      .first();
    const pending = await ctx.db
      .query("scenarioGenJobs")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .first();
    if (running || pending) {
      throw new Error("A scenario generation is already in progress");
    }

    const count = Math.max(1, Math.min(100, args.count ?? 10));

    // Create job record
    const jobId = await ctx.db.insert("scenarioGenJobs", {
      orgId,
      kbId: args.kbId ?? dataset.kbId,
      datasetId: args.datasetId,
      status: "running",
      targetCount: count,
      generatedCount: 0,
      createdAt: Date.now(),
      transcriptUploadIds: args.transcriptUploadIds,
      transcriptConversationIds: args.transcriptConversationIds,
      distribution: args.distribution,
      fidelity: args.fidelity,
    });

    await pool.enqueueAction(
      ctx,
      internal.conversationSim.generationActions.generateScenarios,
      {
        datasetId: args.datasetId,
        kbId: args.kbId ?? dataset.kbId,
        orgId,
        jobId,
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
        context: { jobId: jobId as string },
        onComplete:
          internal.conversationSim.generation.onGenerationComplete,
      },
    );

    return { started: true, jobId };
  },
});

// ─── Progress Update (called by action after each batch) ───

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

// ─── WorkPool Callback ───

export const onGenerationComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ jobId: v.string() })),
  handler: async (
    ctx,
    {
      context,
      result,
    }: {
      workId: string;
      context: { jobId: string };
      result: RunResult;
    },
  ) => {
    const jobId = context.jobId as Id<"scenarioGenJobs">;
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
        error: result.kind === "failed" ? result.error : "Generation cancelled",
        completedAt: Date.now(),
      });
    }
  },
});

// ─── Queries ───

export const getActiveJob = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);

    const running = await ctx.db
      .query("scenarioGenJobs")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "running"))
      .first();
    const pending = await ctx.db
      .query("scenarioGenJobs")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .first();

    const active = running ?? pending;
    if (!active) return null;

    // Filter out stale jobs (>30 min for scenario generation)
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
