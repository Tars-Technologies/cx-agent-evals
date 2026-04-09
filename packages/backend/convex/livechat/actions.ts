"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  parseCSVFromString,
  parseTranscript,
  computeBasicStats,
  extractMicrotopics,
  createClaudeClient,
  type RawConversation,
  type RawTranscriptsFile,
} from "rag-evaluation-system/data-analysis";

export const runAnalysisPipeline = internalAction({
  args: {
    uploadId: v.id("livechatUploads"),
    csvStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    // ── Phase 1: Parsing + stats ──
    try {
      await ctx.runMutation(internal.livechat.orchestration.markParsing, {
        uploadId: args.uploadId,
      });

      // Fetch CSV from storage
      const blob = await ctx.storage.get(args.csvStorageId);
      if (!blob) {
        throw new Error("CSV blob not found in storage");
      }
      const csvText = await blob.text();

      // First pass: compute basic stats
      const stats = await computeBasicStats(parseCSVFromString(csvText));

      // Second pass: build RawConversation[]
      const conversations: RawConversation[] = [];
      for await (const row of parseCSVFromString(csvText)) {
        const messages = parseTranscript(row["Transcript"] || "");
        const labels = (row["Labels"] || "")
          .split(",")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        conversations.push({
          conversationId: row["Conversation ID"] || "",
          visitorId: row["Visitor ID"] || "",
          visitorName: row["Visitor Name"] || "",
          visitorPhone: row["Visitor Phone"] || "",
          visitorEmail: row["Visitor Email"] || "",
          agentId: row["Agent ID"] || "",
          agentName: row["Agent Name"] || "",
          agentEmail: row["Agent Email"] || "",
          inbox: row["Inbox"] || "",
          labels,
          status: row["Status"] || "",
          messages,
          metadata: {
            messageCountVisitor: parseInt(
              row["Number of messages sent by the visitor"] || "0",
              10,
            ),
            messageCountAgent: parseInt(
              row["Number of messages sent by the agent"] || "0",
              10,
            ),
            totalDurationSeconds: parseInt(
              row["Total Conversation duration in Seconds"] || "0",
              10,
            ),
            startDate: row["Start Date"] || "",
            startTime: row["Start Time"] || "",
            replyDate: row["Reply Date"] || "",
            replyTime: row["Reply Time"] || "",
            lastActivityDate: row["Last Activity Date"] || "",
            lastActivityTime: row["Last Activity Time"] || "",
          },
        });
      }

      const rawFile: RawTranscriptsFile = {
        source: "",
        generatedAt: new Date().toISOString(),
        totalConversations: conversations.length,
        conversations,
      };

      // Upload rawTranscripts.json to storage
      const rawBlob = new Blob([JSON.stringify(rawFile)], {
        type: "application/json",
      });
      const rawTranscriptsStorageId = await ctx.storage.store(rawBlob);

      // Fill basicStats.source in-place before saving to row
      stats.source = "";

      await ctx.runMutation(internal.livechat.orchestration.markReady, {
        uploadId: args.uploadId,
        basicStats: stats,
        rawTranscriptsStorageId,
        conversationCount: conversations.length,
      });

      // ── Phase 2: Microtopics ──
      try {
        await ctx.runMutation(
          internal.livechat.orchestration.markMicrotopicsRunning,
          { uploadId: args.uploadId },
        );

        const client = createClaudeClient();
        const microFile = await extractMicrotopics(conversations, {
          claudeClient: client,
          source: "",
          concurrency: 10,
        });

        const microBlob = new Blob([JSON.stringify(microFile)], {
          type: "application/json",
        });
        const microtopicsStorageId = await ctx.storage.store(microBlob);

        await ctx.runMutation(
          internal.livechat.orchestration.markMicrotopicsReady,
          {
            uploadId: args.uploadId,
            microtopicsStorageId,
            processedConversations: microFile.processedConversations,
            failedConversationCount: microFile.failures.length,
          },
        );
      } catch (mtErr: unknown) {
        const message =
          mtErr instanceof Error ? mtErr.message : "Unknown microtopics error";
        await ctx.runMutation(
          internal.livechat.orchestration.markMicrotopicsFailed,
          { uploadId: args.uploadId, error: message },
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await ctx.runMutation(internal.livechat.orchestration.markFailed, {
        uploadId: args.uploadId,
        error: message,
      });
    }
  },
});
