import type { CharacterSpan, Corpus } from "../types/index.js";
import { positionAwareChunkToSpan } from "../types/index.js";
import type { Metric } from "../evaluation/metrics/base.js";
import type { Retriever } from "../retrievers/retriever.interface.js";
import { DocumentId } from "../types/primitives.js";
import { recall, precision, iou, f1 } from "../evaluation/index.js";
import type { SerializedSpan, ExperimentResult } from "../shared/types.js";

/** Default metrics used for LangSmith experiments. */
export const DEFAULT_METRICS: readonly Metric[] = [recall, precision, iou, f1];

export interface LangSmithExperimentConfig {
  readonly corpus: Corpus;
  readonly retriever: Retriever;
  readonly k: number;
  readonly datasetName: string;
  readonly metrics?: readonly Metric[];
  readonly experimentPrefix?: string;
  readonly metadata?: Record<string, unknown>;
  readonly onResult?: (result: ExperimentResult) => Promise<void>;
}

export function deserializeSpans(raw: unknown): CharacterSpan[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: SerializedSpan) => ({
    docId: DocumentId(s.docId),
    start: s.start,
    end: s.end,
    text: s.text,
  }));
}

export function createLangSmithEvaluator(metric: Metric) {
  return (args: {
    outputs?: Record<string, unknown>;
    referenceOutputs?: Record<string, unknown>;
  }) => {
    const retrieved = deserializeSpans(args.outputs?.relevantSpans);
    const groundTruth = deserializeSpans(args.referenceOutputs?.relevantSpans);
    const score = metric.calculate(retrieved, groundTruth);
    return { key: metric.name, score };
  };
}

export function createLangSmithEvaluators(metrics: readonly Metric[]) {
  return metrics.map(createLangSmithEvaluator);
}

/**
 * Run a retrieval experiment via LangSmith's evaluate() function.
 *
 * Initializes the retriever, creates a target function that converts
 * retrieved chunks to serialized spans, and evaluates each dataset
 * example using the configured metrics. An optional `onResult` callback
 * fires per-example with the full result data (query, spans, scores).
 */
export async function runLangSmithExperiment(
  config: LangSmithExperimentConfig,
): Promise<void> {
  const {
    corpus,
    retriever,
    k,
    datasetName,
    experimentPrefix,
    metadata,
    onResult,
  } = config;
  const metrics = config.metrics ?? DEFAULT_METRICS;

  await retriever.init(corpus);

  try {
    const target = async (inputs: { query: string }) => {
      const chunks = await retriever.retrieve(inputs.query, k);
      return {
        relevantSpans: chunks.map((chunk) => {
          const span = positionAwareChunkToSpan(chunk);
          return {
            docId: String(span.docId),
            start: span.start,
            end: span.end,
            text: span.text,
          };
        }),
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evaluators: Array<(...args: any[]) => any> = [
      ...createLangSmithEvaluators(metrics),
    ];

    if (onResult) {
      evaluators.push(
        async (args: {
          inputs?: Record<string, unknown>;
          outputs?: Record<string, unknown>;
          referenceOutputs?: Record<string, unknown>;
        }) => {
          const query = String(args.inputs?.query ?? "");
          const retrievedSpans = (args.outputs?.relevantSpans ??
            []) as ExperimentResult["retrievedSpans"];
          const retrieved = deserializeSpans(args.outputs?.relevantSpans);
          const groundTruth = deserializeSpans(
            args.referenceOutputs?.relevantSpans,
          );

          const scores: Record<string, number> = {};
          for (const metric of metrics) {
            scores[metric.name] = metric.calculate(retrieved, groundTruth);
          }

          await onResult({ query, retrievedSpans, scores });
          return { key: "_onResultSync", score: 1 };
        },
      );
    }

    const { evaluate } = await import("langsmith/evaluation");

    // Log LangSmith connection details for debugging auth issues
    const apiUrl = process.env.LANGCHAIN_ENDPOINT ?? process.env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com";
    const hasApiKey = !!process.env.LANGSMITH_API_KEY;
    const keyPrefix = process.env.LANGSMITH_API_KEY
      ? process.env.LANGSMITH_API_KEY.slice(0, 8) + "..."
      : "(not set)";
    console.log(
      `[LangSmith] Connecting to ${apiUrl} | API key present: ${hasApiKey} (${keyPrefix}) | Dataset: "${datasetName}"`,
    );

    try {
      await evaluate(target, {
        data: datasetName,
        evaluators,
        experimentPrefix: experimentPrefix ?? retriever.name,
        metadata: {
          retriever: retriever.name,
          k,
          corpusSize: corpus.documents.length,
          ...metadata,
        },
      });
    } catch (error: unknown) {
      // Log full error details for LangSmith API failures
      const err = error as Error & { statusCode?: number; body?: string };
      console.error("[LangSmith] evaluate() failed:", {
        message: err.message,
        statusCode: err.statusCode,
        body: err.body,
        apiUrl,
        datasetName,
        keyPrefix,
        stack: err.stack,
      });
      throw error;
    }
  } finally {
    await retriever.cleanup();
  }
}
