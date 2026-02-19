import type { Corpus } from "../types/index.js";
import type { Retriever } from "../retrievers/retriever.interface.js";
import type { Metric } from "../evaluation/metrics/base.js";
import { recall, precision, iou, f1 } from "../evaluation/metrics/index.js";
import { positionAwareChunkToSpan } from "../types/chunks.js";
import { createLangSmithEvaluators, deserializeSpans } from "./evaluator-adapters.js";

export interface ExperimentResult {
  query: string;
  retrievedSpans: Array<{ docId: string; start: number; end: number; text: string }>;
  scores: Record<string, number>;
}

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

const DEFAULT_METRICS: readonly Metric[] = [recall, precision, iou, f1];

export async function runLangSmithExperiment(config: LangSmithExperimentConfig): Promise<void> {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangSmith evaluate() accepts both sync and async evaluators
    const evaluators: Array<(...args: any[]) => any> = [...createLangSmithEvaluators(metrics)];

    // When onResult is provided, append a callback evaluator that computes
    // all metrics and fires the callback with the complete result data.
    if (onResult) {
      evaluators.push(async (args: {
        inputs?: Record<string, unknown>;
        outputs?: Record<string, unknown>;
        referenceOutputs?: Record<string, unknown>;
      }) => {
        const query = String(args.inputs?.query ?? "");
        const retrievedSpans = (args.outputs?.relevantSpans ?? []) as ExperimentResult["retrievedSpans"];
        const retrieved = deserializeSpans(args.outputs?.relevantSpans);
        const groundTruth = deserializeSpans(args.referenceOutputs?.relevantSpans);

        const scores: Record<string, number> = {};
        for (const metric of metrics) {
          scores[metric.name] = metric.calculate(retrieved, groundTruth);
        }

        await onResult({ query, retrievedSpans, scores });
        return { key: "_onResultSync", score: 1 };
      });
    }

    const { evaluate } = await import("langsmith/evaluation");

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
  } finally {
    await retriever.cleanup();
  }
}
