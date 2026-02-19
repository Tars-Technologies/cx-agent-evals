import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLangSmithExperiment } from "../../../src/langsmith/experiment-runner.js";
import type { Retriever } from "../../../src/retrievers/retriever.interface.js";
import type { Corpus, PositionAwareChunk } from "../../../src/types/index.js";
import { DocumentId, PositionAwareChunkId } from "../../../src/types/primitives.js";
import { recall } from "../../../src/evaluation/metrics/recall.js";

// Mock the langsmith/evaluation module
vi.mock("langsmith/evaluation", () => ({
  evaluate: vi.fn().mockResolvedValue({
    experimentName: "test-experiment",
    results: [],
  }),
}));

describe("runLangSmithExperiment", () => {
  let mockRetriever: Retriever;
  let corpus: Corpus;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRetriever = {
      name: "mock-retriever",
      init: vi.fn().mockResolvedValue(undefined),
      retrieve: vi.fn().mockResolvedValue([
        {
          id: PositionAwareChunkId("pa_1"),
          content: "test content",
          docId: DocumentId("doc1"),
          start: 0,
          end: 12,
          metadata: {},
        } as PositionAwareChunk,
      ]),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };

    corpus = {
      id: "test-corpus",
      documents: [
        { id: DocumentId("doc1"), content: "test content here", metadata: {} },
      ],
    };
  });

  it("should initialize retriever before evaluation", async () => {
    await runLangSmithExperiment({
      corpus,
      retriever: mockRetriever,
      k: 5,
      datasetName: "test-dataset",
    });

    expect(mockRetriever.init).toHaveBeenCalledWith(corpus);
  });

  it("should call langsmith evaluate with correct config", async () => {
    const { evaluate } = await import("langsmith/evaluation");

    await runLangSmithExperiment({
      corpus,
      retriever: mockRetriever,
      k: 5,
      datasetName: "test-dataset",
      experimentPrefix: "my-experiment",
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: "test-dataset",
        experimentPrefix: "my-experiment",
        metadata: expect.objectContaining({
          retriever: "mock-retriever",
          k: 5,
          corpusSize: 1,
        }),
      }),
    );
  });

  it("should use retriever name as experiment prefix when not provided", async () => {
    const { evaluate } = await import("langsmith/evaluation");

    await runLangSmithExperiment({
      corpus,
      retriever: mockRetriever,
      k: 5,
      datasetName: "test-dataset",
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        experimentPrefix: "mock-retriever",
      }),
    );
  });

  it("should pass custom metadata merged with default metadata", async () => {
    const { evaluate } = await import("langsmith/evaluation");

    await runLangSmithExperiment({
      corpus,
      retriever: mockRetriever,
      k: 5,
      datasetName: "test-dataset",
      metadata: { chunker: "recursive-512" },
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        metadata: expect.objectContaining({
          retriever: "mock-retriever",
          k: 5,
          corpusSize: 1,
          chunker: "recursive-512",
        }),
      }),
    );
  });

  it("should create correct number of evaluators for default metrics", async () => {
    const { evaluate } = await import("langsmith/evaluation");

    await runLangSmithExperiment({
      corpus,
      retriever: mockRetriever,
      k: 5,
      datasetName: "test-dataset",
    });

    const call = (evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = call[1];
    // Default metrics: recall, precision, iou, f1
    expect(options.evaluators).toHaveLength(4);
  });

  it("should use custom metrics when provided", async () => {
    const { evaluate } = await import("langsmith/evaluation");

    await runLangSmithExperiment({
      corpus,
      retriever: mockRetriever,
      k: 5,
      datasetName: "test-dataset",
      metrics: [recall],
    });

    const call = (evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = call[1];
    expect(options.evaluators).toHaveLength(1);
  });

  it("should cleanup retriever after success", async () => {
    await runLangSmithExperiment({
      corpus,
      retriever: mockRetriever,
      k: 5,
      datasetName: "test-dataset",
    });

    expect(mockRetriever.cleanup).toHaveBeenCalled();
  });

  it("should cleanup retriever even on error", async () => {
    const { evaluate } = await import("langsmith/evaluation");
    (evaluate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("eval error"));

    await expect(
      runLangSmithExperiment({
        corpus,
        retriever: mockRetriever,
        k: 5,
        datasetName: "test-dataset",
      }),
    ).rejects.toThrow("eval error");

    expect(mockRetriever.cleanup).toHaveBeenCalled();
  });

  describe("target function", () => {
    it("should convert retrieved chunks to serialized spans", async () => {
      const { evaluate } = await import("langsmith/evaluation");
      let capturedTarget: Function;

      (evaluate as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (target: Function, _options: unknown) => {
          capturedTarget = target;
          return { experimentName: "test", results: [] };
        },
      );

      await runLangSmithExperiment({
        corpus,
        retriever: mockRetriever,
        k: 5,
        datasetName: "test-dataset",
      });

      const result = await capturedTarget!({ query: "test query" });
      expect(result.relevantSpans).toEqual([
        {
          docId: "doc1",
          start: 0,
          end: 12,
          text: "test content",
        },
      ]);
      expect(mockRetriever.retrieve).toHaveBeenCalledWith("test query", 5);
    });
  });
});
