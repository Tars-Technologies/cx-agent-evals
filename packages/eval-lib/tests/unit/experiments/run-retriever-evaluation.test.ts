import { describe, expect, it, vi } from "vitest"
import { runRetrieverEvaluation } from "../../../src/experiments/run-retriever-evaluation.js"
import { DEFAULT_METRICS as ROOT_DEFAULT_METRICS } from "../../../src/index.js"
import type { ExperimentResult } from "../../../src/shared/types.js"
import type { Corpus, PositionAwareChunk } from "../../../src/types/index.js"
import {
  DocumentId,
  PositionAwareChunkId
} from "../../../src/types/primitives.js"

const corpus: Corpus = {
  documents: [{ id: DocumentId("doc1"), content: "Hello world", metadata: {} }],
  metadata: {}
}

const chunk = (start: number, end: number, content: string): PositionAwareChunk => ({
  id: PositionAwareChunkId(`${start}:${end}`),
  docId: DocumentId("doc1"),
  content,
  start,
  end,
  metadata: {}
})

describe("runRetrieverEvaluation", () => {
  it("exposes the native default metrics from the package root", () => {
    expect(ROOT_DEFAULT_METRICS.map((metric) => metric.name)).toEqual([
      "recall",
      "precision",
      "iou",
      "f1"
    ])
  })

  it("scores each example and fires onResult, calling init/cleanup once", async () => {
    const retriever = {
      name: "test",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => [chunk(0, 11, "Hello world")]),
      cleanup: vi.fn(async () => {})
    }
    const results: ExperimentResult[] = []
    await runRetrieverEvaluation({
      corpus,
      retriever,
      k: 5,
      dataset: [
        {
          query: "hi",
          groundTruth: [{ docId: DocumentId("doc1"), start: 0, end: 11, text: "Hello world" }]
        }
      ],
      onResult: async (r) => {
        results.push(r)
      }
    })
    expect(retriever.init).toHaveBeenCalledOnce()
    expect(retriever.cleanup).toHaveBeenCalledOnce()
    expect(results).toHaveLength(1)
    expect(results[0].query).toBe("hi")
    expect(results[0].scores.recall).toBe(1)
    expect(results[0].retrievedSpans[0].docId).toBe("doc1")
  })

  it("runs cleanup even when retrieve throws", async () => {
    const retriever = {
      name: "boom",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => {
        throw new Error("nope")
      }),
      cleanup: vi.fn(async () => {})
    }
    await expect(
      runRetrieverEvaluation({
        corpus,
        retriever,
        k: 5,
        dataset: [{ query: "q", groundTruth: [] }]
      })
    ).rejects.toThrow("nope")
    expect(retriever.cleanup).toHaveBeenCalledOnce()
  })

  it("runs cleanup and preserves the initialization error when init throws", async () => {
    const initError = new Error("init failed")
    const retriever = {
      name: "init-failure",
      init: vi.fn(async () => {
        throw initError
      }),
      retrieve: vi.fn(async () => []),
      cleanup: vi.fn(async () => {})
    }

    await expect(
      runRetrieverEvaluation({
        corpus,
        retriever,
        k: 5,
        dataset: [{ query: "q", groundTruth: [] }]
      })
    ).rejects.toBe(initError)
    expect(retriever.cleanup).toHaveBeenCalledOnce()
    expect(retriever.retrieve).not.toHaveBeenCalled()
  })

  it("preserves primary and cleanup failures in an AggregateError", async () => {
    const retrieveError = new Error("retrieve failed")
    const cleanupError = new Error("cleanup failed")
    const retriever = {
      name: "dual-failure",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => {
        throw retrieveError
      }),
      cleanup: vi.fn(async () => {
        throw cleanupError
      })
    }

    const failure = runRetrieverEvaluation({
      corpus,
      retriever,
      k: 5,
      dataset: [{ query: "q", groundTruth: [] }]
    }).catch((error: unknown) => error)

    await expect(failure).resolves.toMatchObject({
      name: "AggregateError",
      message: "Retriever evaluation and cleanup both failed",
      errors: [retrieveError, cleanupError]
    })
    expect(retriever.cleanup).toHaveBeenCalledOnce()
  })

  it("propagates a cleanup-only failure unchanged", async () => {
    const cleanupError = new Error("cleanup failed")
    const retriever = {
      name: "cleanup-failure",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => []),
      cleanup: vi.fn(async () => {
        throw cleanupError
      })
    }

    await expect(
      runRetrieverEvaluation({
        corpus,
        retriever,
        k: 5,
        dataset: [{ query: "q", groundTruth: [] }]
      })
    ).rejects.toBe(cleanupError)
  })

  it("processes every example exactly once under concurrency > 1", async () => {
    const retriever = {
      name: "concurrent",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => [chunk(0, 11, "Hello world")]),
      cleanup: vi.fn(async () => {})
    }
    const dataset = Array.from({ length: 7 }, (_, i) => ({
      query: `q${i}`,
      groundTruth: []
    }))
    const seen: string[] = []
    await runRetrieverEvaluation({
      corpus,
      retriever,
      k: 5,
      dataset,
      maxConcurrency: 3,
      onResult: async (r) => {
        seen.push(r.query)
      }
    })
    expect(retriever.init).toHaveBeenCalledOnce()
    expect(retriever.cleanup).toHaveBeenCalledOnce()
    expect(seen.sort()).toEqual(dataset.map((d) => d.query).sort())
  })

  it("preserves stable example IDs when query text is duplicated", async () => {
    const retriever = {
      name: "duplicate-queries",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => []),
      cleanup: vi.fn(async () => {})
    }
    const results: ExperimentResult[] = []

    await runRetrieverEvaluation({
      corpus,
      retriever,
      k: 5,
      dataset: [
        { exampleId: "question-1", query: "same query", groundTruth: [] },
        { exampleId: "question-2", query: "same query", groundTruth: [] }
      ],
      onResult: async (result) => {
        results.push(result)
      }
    })

    expect(results.map((result) => result.exampleId)).toEqual([
      "question-1",
      "question-2"
    ])
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    0,
    -1,
    1.5
  ])("rejects invalid maxConcurrency %s before initializing the retriever", async (maxConcurrency) => {
    const retriever = {
      name: "invalid-concurrency",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => []),
      cleanup: vi.fn(async () => {})
    }

    await expect(
      runRetrieverEvaluation({
        corpus,
        retriever,
        k: 5,
        dataset: [{ query: "q", groundTruth: [] }],
        maxConcurrency
      })
    ).rejects.toThrow(
      new RangeError("maxConcurrency must be a safe positive integer")
    )
    expect(retriever.init).not.toHaveBeenCalled()
    expect(retriever.cleanup).not.toHaveBeenCalled()
  })

  it("waits for sibling workers to settle before cleanup when one throws", async () => {
    let cleaned = false
    let retrievedAfterCleanup = false
    const retriever = {
      name: "race",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async (query: string) => {
        if (cleaned) retrievedAfterCleanup = true
        await Promise.resolve()
        if (query === "q1") throw new Error("nope")
        return [chunk(0, 11, "Hello world")]
      }),
      cleanup: vi.fn(async () => {
        cleaned = true
      })
    }
    const dataset = Array.from({ length: 6 }, (_, i) => ({
      query: `q${i}`,
      groundTruth: []
    }))
    await expect(
      runRetrieverEvaluation({
        corpus,
        retriever,
        k: 5,
        dataset,
        maxConcurrency: 3
      })
    ).rejects.toThrow("nope")
    expect(retriever.cleanup).toHaveBeenCalledOnce()
    expect(retrievedAfterCleanup).toBe(false)
  })

  it("skips chunks with invalid span offsets and still fires onResult", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const retriever = {
      name: "invalid-span",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => [chunk(5, 5, "")]),
      cleanup: vi.fn(async () => {})
    }
    const results: ExperimentResult[] = []
    await runRetrieverEvaluation({
      corpus,
      retriever,
      k: 5,
      dataset: [{ query: "q", groundTruth: [] }],
      onResult: async (r) => {
        results.push(r)
      }
    })
    expect(warn).toHaveBeenCalledOnce()
    expect(results).toHaveLength(1)
    expect(results[0].retrievedSpans).toHaveLength(0)
    warn.mockRestore()
  })
})
