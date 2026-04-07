"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  QueryId,
  QueryText,
  DocumentId,
  type GroundTruth,
  type CharacterSpan,
} from "rag-evaluation-system";
import { uploadDataset, getLangSmithClient } from "rag-evaluation-system/langsmith";

// ─── Dataset Sync ───

/**
 * Sync a dataset to LangSmith.
 * Reads all questions, converts to GroundTruth[], uploads via LangSmith client.
 */
export const syncDataset = internalAction({
  args: {
    datasetId: v.id("datasets"),
  },
  handler: async (ctx, args) => {
    // Update sync status to syncing
    await ctx.runMutation(internal.crud.datasets.updateSyncStatus, {
      datasetId: args.datasetId,
      langsmithSyncStatus: "syncing",
    });

    try {
      const dataset = await ctx.runQuery(internal.crud.datasets.getInternal, {
        id: args.datasetId,
      });

      const allQuestions = await ctx.runQuery(
        internal.crud.questions.byDatasetInternal,
        { datasetId: args.datasetId },
      );
      // Only sync questions with ground truth spans — questions without
      // spans produce meaningless retriever metrics.
      const questions = allQuestions.filter(
        (q: any) => Array.isArray(q.relevantSpans) && q.relevantSpans.length > 0,
      );

      if (questions.length === 0) {
        await ctx.runMutation(internal.crud.datasets.updateSyncStatus, {
          datasetId: args.datasetId,
          langsmithSyncStatus: "skipped",
        });
        return;
      }

      // Convert questions to GroundTruth format
      const groundTruth: GroundTruth[] = questions.map(
        (q: any, i: number) => ({
          query: {
            id: QueryId(q.queryId || `q_${i}`),
            text: QueryText(q.queryText),
            metadata: {
              sourceDoc: q.sourceDocId,
              ...(q.metadata ?? {}),
            },
          },
          relevantSpans: (q.relevantSpans ?? []).map(
            (s: any) =>
              ({
                docId: DocumentId(s.docId),
                start: s.start,
                end: s.end,
                text: s.text,
              }) as CharacterSpan,
          ),
        }),
      );

      // Delete any existing LangSmith dataset with this name to avoid
      // stale examples from a previous sync.
      try {
        const deleteClient = await getLangSmithClient();
        await deleteClient.deleteDataset({ datasetName: dataset.name });
      } catch {
        // Dataset may not exist yet — ignore
      }

      // Upload to LangSmith
      const result = await uploadDataset(groundTruth, {
        datasetName: dataset.name,
        description: `RAG evaluation dataset: ${dataset.strategy} strategy, ${questions.length} questions`,
        metadata: {
          strategy: dataset.strategy,
          convexDatasetId: args.datasetId,
        },
      });

      // Update dataset with LangSmith info and aligned question count
      await ctx.runMutation(internal.crud.datasets.updateSyncStatus, {
        datasetId: args.datasetId,
        langsmithDatasetId: result.datasetName,
        langsmithUrl: result.datasetUrl,
        langsmithSyncStatus: "synced",
      });
      await ctx.runMutation(internal.crud.datasets.updateQuestionCount, {
        datasetId: args.datasetId,
        questionCount: questions.length,
      });

      // Link LangSmith example IDs back to questions for experiment result correlation
      try {
        const client = await getLangSmithClient();
        // List examples from the dataset we just created
        const examples: Array<{ id: string; inputs: { query?: string } }> = [];
        for await (const ex of client.listExamples({ datasetName: result.datasetName })) {
          examples.push(ex as any);
        }

        // Match examples to questions by query text
        const updates: Array<{ questionId: typeof questions[number]["_id"]; langsmithExampleId: string }> = [];
        for (const q of questions) {
          const match = examples.find(
            (ex) => ex.inputs?.query === q.queryText,
          );
          if (match) {
            updates.push({ questionId: q._id, langsmithExampleId: match.id });
          }
        }

        if (updates.length > 0) {
          await ctx.runMutation(internal.crud.questions.updateLangsmithExampleIds, {
            updates,
          });
        }
      } catch (err) {
        // Non-fatal — experiment runs work without example IDs
        console.error("Failed to link LangSmith example IDs:", err);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.crud.datasets.updateSyncStatus, {
        datasetId: args.datasetId,
        langsmithSyncStatus: `failed: ${message}`,
      });
    }
  },
});

// Experiment sync is now handled natively by evaluate() inside runLangSmithExperiment().
// Manual retry mutations are in langsmithRetry.ts (mutations can't be in "use node" files)
