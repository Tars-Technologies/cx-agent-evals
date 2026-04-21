"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  parseCSVFromString,
  parseTranscript,
  computeBasicStats,
  preprocessConversation,
  createClaudeClient,
  classifyMessageTypes,
  translateMessages,
  needsTranslation,
  type RawConversation,
} from "rag-evaluation-system/data-analysis";

export const runAnalysisPipeline = internalAction({
  args: {
    uploadId: v.id("livechatUploads"),
    csvStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.livechat.orchestration.markParsing, {
        uploadId: args.uploadId,
      });

      const blob = await ctx.storage.get(args.csvStorageId);
      if (!blob) throw new Error("CSV blob not found in storage");
      const csvText = await blob.text();

      // First pass: compute basic stats
      const stats = await computeBasicStats(parseCSVFromString(csvText));

      // Second pass: build conversations array
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

      // Extract botFlowInput for each conversation during parsing
      const conversationRows = conversations.map((conv) => {
        const preprocess = preprocessConversation(conv);
        return {
          ...conv,
          botFlowInput: preprocess.botFlowInput
            ? { intent: preprocess.botFlowInput.intent, language: preprocess.botFlowInput.language }
            : undefined,
        };
      });

      // Batch-insert conversation rows (500 per mutation)
      const BATCH_SIZE = 500;
      for (let i = 0; i < conversationRows.length; i += BATCH_SIZE) {
        const batch = conversationRows.slice(i, i + BATCH_SIZE);
        const upload = await ctx.runQuery(
          internal.livechat.orchestration.getUploadInternal,
          { uploadId: args.uploadId },
        );
        if (!upload) throw new Error("Upload row not found");

        await ctx.runMutation(
          internal.livechat.orchestration.insertConversationBatch,
          {
            uploadId: args.uploadId,
            orgId: upload.orgId,
            conversations: batch,
          },
        );
        await ctx.runMutation(
          internal.livechat.orchestration.markParsingProgress,
          {
            uploadId: args.uploadId,
            processed: Math.min(i + BATCH_SIZE, conversationRows.length),
          },
        );
      }

      stats.source = "";
      await ctx.runMutation(internal.livechat.orchestration.markReady, {
        uploadId: args.uploadId,
        basicStats: stats,
        conversationCount: conversationRows.length,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await ctx.runMutation(internal.livechat.orchestration.markFailed, {
        uploadId: args.uploadId,
        error: message,
      });
    }
  },
});

export const classifyConversations = internalAction({
  args: {
    conversationIds: v.array(v.id("livechatConversations")),
    templateId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.conversationIds.length > 100) {
      throw new Error("Cannot classify more than 100 conversations");
    }

    const templateId = args.templateId ?? "cx-transcript-analysis";
    const client = createClaudeClient();
    const CONCURRENCY = 10;

    const processOne = async (convId: (typeof args.conversationIds)[0]) => {
      try {
        await ctx.runMutation(
          internal.livechat.orchestration.patchClassificationStatus,
          {
            conversationId: convId,
            status: "running",
          },
        );

        const conv = await ctx.runQuery(
          internal.livechat.orchestration.getConversationInternal,
          { id: convId },
        );
        if (!conv) throw new Error("Conversation not found");

        const rawConv: RawConversation = {
          conversationId: conv.conversationId,
          visitorId: conv.visitorId,
          visitorName: conv.visitorName,
          visitorPhone: conv.visitorPhone,
          visitorEmail: conv.visitorEmail,
          agentId: conv.agentId,
          agentName: conv.agentName,
          agentEmail: conv.agentEmail,
          inbox: conv.inbox,
          labels: conv.labels,
          status: conv.status,
          messages: conv.messages,
          metadata: conv.metadata,
        };

        const result = await classifyMessageTypes(rawConv, { claudeClient: client, templateId });

        await ctx.runMutation(
          internal.livechat.orchestration.patchClassificationStatus,
          {
            conversationId: convId,
            status: "done",
            messageTypes: result.blocks,
            classifiedMessages: result.classifiedMessages,
            blocks: result.blocks,
            templateId,
          },
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Classification failed";
        await ctx.runMutation(
          internal.livechat.orchestration.patchClassificationStatus,
          {
            conversationId: convId,
            status: "failed",
            error: message,
          },
        );
      }
    };

    for (let i = 0; i < args.conversationIds.length; i += CONCURRENCY) {
      const batch = args.conversationIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processOne));
    }
  },
});

export const translateConversations = internalAction({
  args: {
    conversationIds: v.array(v.id("livechatConversations")),
  },
  handler: async (ctx, args) => {
    if (args.conversationIds.length > 100) {
      throw new Error("Cannot translate more than 100 conversations");
    }

    const client = createClaudeClient();
    const CONCURRENCY = 10;

    const processOne = async (convId: (typeof args.conversationIds)[0]) => {
      try {
        await ctx.runMutation(
          internal.livechat.orchestration.patchTranslationStatus,
          {
            conversationId: convId,
            status: "running",
          },
        );

        const conv = await ctx.runQuery(
          internal.livechat.orchestration.getConversationInternal,
          { id: convId },
        );
        if (!conv) throw new Error("Conversation not found");

        const messagesToTranslate = conv.messages
          .filter((m: { text: string }) => needsTranslation(m.text))
          .map((m: { id: number; text: string }) => ({ id: m.id, text: m.text }));

        if (messagesToTranslate.length === 0) {
          await ctx.runMutation(
            internal.livechat.orchestration.patchTranslationStatus,
            {
              conversationId: convId,
              status: "done",
              translatedMessages: [],
            },
          );
          return;
        }

        const translations = await translateMessages(messagesToTranslate, client);

        await ctx.runMutation(
          internal.livechat.orchestration.patchTranslationStatus,
          {
            conversationId: convId,
            status: "done",
            translatedMessages: translations,
          },
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Translation failed";
        await ctx.runMutation(
          internal.livechat.orchestration.patchTranslationStatus,
          {
            conversationId: convId,
            status: "failed",
            error: message,
          },
        );
      }
    };

    for (let i = 0; i < args.conversationIds.length; i += CONCURRENCY) {
      const batch = args.conversationIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processOne));
    }
  },
});

export const deleteUploadData = internalAction({
  args: {
    uploadId: v.id("livechatUploads"),
    csvStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    let hasMore = true;
    while (hasMore) {
      const batch = await ctx.runQuery(
        internal.livechat.orchestration.getConversationBatchForDelete,
        { uploadId: args.uploadId, limit: 500 },
      );
      if (batch.length === 0) {
        hasMore = false;
        break;
      }
      await ctx.runMutation(
        internal.livechat.orchestration.deleteConversationBatch,
        {
          ids: batch.map((c: any) => c._id),
        },
      );
    }
    await ctx.runMutation(internal.livechat.orchestration.finalizeDelete, {
      uploadId: args.uploadId,
      csvStorageId: args.csvStorageId,
    });
  },
});
