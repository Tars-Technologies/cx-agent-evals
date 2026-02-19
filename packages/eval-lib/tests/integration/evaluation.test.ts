import { describe, it, expect, vi } from "vitest";
import { runLangSmithExperiment } from "../../src/langsmith/experiment-runner.js";
import { VectorRAGRetriever } from "../../src/retrievers/baseline-vector-rag/retriever.js";
import { RecursiveCharacterChunker } from "../../src/chunkers/recursive-character.js";
import { InMemoryVectorStore } from "../../src/vector-stores/in-memory.js";
import { createDocument, createCorpus } from "../../src/types/documents.js";
import { mockEmbedder } from "../fixtures.js";

// Mock the langsmith/evaluation module
vi.mock("langsmith/evaluation", () => ({
  evaluate: vi.fn().mockResolvedValue({
    experimentName: "integration-test",
    results: [],
  }),
}));

const content =
  "Retrieval-Augmented Generation (RAG) combines retrieval with generation. " +
  "It retrieves relevant documents and uses them to generate answers. " +
  "RAG improves accuracy by grounding responses in real data. " +
  "The retrieval step is critical for RAG performance.";

const doc = createDocument({ id: "rag.md", content });
const corpus = createCorpus([doc]);
const chunker = new RecursiveCharacterChunker({ chunkSize: 80, chunkOverlap: 0 });
const embedder = mockEmbedder(64);

describe("runLangSmithExperiment integration", () => {
  it("should initialize VectorRAGRetriever and call langsmith evaluate", async () => {
    const { evaluate } = await import("langsmith/evaluation");

    const retriever = new VectorRAGRetriever({
      chunker,
      embedder,
      vectorStore: new InMemoryVectorStore(),
    });

    await runLangSmithExperiment({
      corpus,
      retriever,
      k: 3,
      datasetName: "test-dataset",
      experimentPrefix: "integration-test",
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: "test-dataset",
        experimentPrefix: "integration-test",
        evaluators: expect.any(Array),
      }),
    );
  });

  it("should pass target function that returns relevantSpans", async () => {
    const { evaluate } = await import("langsmith/evaluation");
    let targetResult: any;

    (evaluate as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (target: Function, _options: unknown) => {
        // Call target during evaluate (before cleanup)
        targetResult = await target({ query: "What is RAG?" });
        return { experimentName: "test", results: [] };
      },
    );

    const retriever = new VectorRAGRetriever({
      chunker,
      embedder,
      vectorStore: new InMemoryVectorStore(),
    });

    await runLangSmithExperiment({
      corpus,
      retriever,
      k: 3,
      datasetName: "test-dataset",
    });

    expect(targetResult).toHaveProperty("relevantSpans");
    expect(Array.isArray(targetResult.relevantSpans)).toBe(true);
    if (targetResult.relevantSpans.length > 0) {
      const span = targetResult.relevantSpans[0];
      expect(span).toHaveProperty("docId");
      expect(span).toHaveProperty("start");
      expect(span).toHaveProperty("end");
      expect(span).toHaveProperty("text");
    }
  });
});
