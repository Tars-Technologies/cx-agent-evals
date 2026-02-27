"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  QueryId,
  QueryText,
  DocumentId,
  type GroundTruth,
  type CharacterSpan,
} from "rag-evaluation-system";
import { getLangSmithClient } from "./lib/langsmith.js";

// ─── Inlined from eval-lib/src/langsmith/upload.ts ───

interface UploadProgress {
  uploaded: number;
  total: number;
  failed: number;
}

interface UploadOptions {
  datasetName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  batchSize?: number;
  maxRetries?: number;
  onProgress?: (progress: UploadProgress) => void;
}

interface UploadResult {
  datasetName: string;
  datasetUrl: string;
  uploaded: number;
  failed: number;
}

async function uploadDataset(
  groundTruth: readonly GroundTruth[],
  options?: UploadOptions,
): Promise<UploadResult> {
  const client = await getLangSmithClient();
  const name = options?.datasetName ?? "rag-eval-dataset";
  const batchSize = options?.batchSize ?? 20;
  const maxRetries = options?.maxRetries ?? 3;
  const onProgress = options?.onProgress;

  const dataset = await client.createDataset(name, {
    description:
      options?.description ?? "RAG evaluation ground truth (character spans)",
    metadata: options?.metadata,
  });

  const datasetUrl = `${client.getHostUrl()}/datasets/${dataset.id}`;

  // Build all examples upfront
  const examples = groundTruth.map((gt) => ({
    inputs: { query: String(gt.query.text) },
    outputs: {
      relevantSpans: gt.relevantSpans.map((span) => ({
        docId: String(span.docId),
        start: span.start,
        end: span.end,
        text: span.text,
      })),
    },
    metadata: gt.query.metadata as Record<string, unknown>,
    dataset_id: dataset.id,
  }));

  let uploaded = 0;
  let failed = 0;
  const total = examples.length;

  // Upload in batches
  for (let i = 0; i < total; i += batchSize) {
    const batch = examples.slice(i, i + batchSize);
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries) {
      try {
        await client.createExamples(batch);
        uploaded += batch.length;
        success = true;
        break;
      } catch {
        attempt++;
        if (attempt >= maxRetries) {
          failed += batch.length;
        }
      }
    }

    if (success || attempt >= maxRetries) {
      onProgress?.({ uploaded, total, failed });
    }
  }

  return { datasetName: name, datasetUrl, uploaded, failed };
}

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
    await ctx.runMutation(internal.datasets.updateSyncStatus, {
      datasetId: args.datasetId,
      langsmithSyncStatus: "syncing",
    });

    try {
      const dataset = await ctx.runQuery(internal.datasets.getInternal, {
        id: args.datasetId,
      });

      const questions = await ctx.runQuery(
        internal.questions.byDatasetInternal,
        { datasetId: args.datasetId },
      );

      if (questions.length === 0) {
        await ctx.runMutation(internal.datasets.updateSyncStatus, {
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

      // Upload to LangSmith
      const result = await uploadDataset(groundTruth, {
        datasetName: dataset.name,
        description: `RAG evaluation dataset: ${dataset.strategy} strategy, ${questions.length} questions`,
        metadata: {
          strategy: dataset.strategy,
          convexDatasetId: args.datasetId,
        },
      });

      // Update dataset with LangSmith info
      await ctx.runMutation(internal.datasets.updateSyncStatus, {
        datasetId: args.datasetId,
        langsmithDatasetId: result.datasetName,
        langsmithUrl: result.datasetUrl,
        langsmithSyncStatus: "synced",
      });

      // I5: Link LangSmith example IDs back to questions for experiment result correlation
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
          await ctx.runMutation(internal.questions.updateLangsmithExampleIds, {
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
      await ctx.runMutation(internal.datasets.updateSyncStatus, {
        datasetId: args.datasetId,
        langsmithSyncStatus: `failed: ${message}`,
      });
    }
  },
});

// Experiment sync is now handled natively by evaluate() inside runLangSmithExperiment().
// Manual retry mutations are in langsmithRetry.ts (mutations can't be in "use node" files)
