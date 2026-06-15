import { describe, expect, it } from "vitest"
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js"
import { GroundTruthAssigner } from "../../../../src/synthetic-datagen/ground-truth/token-level.js"
import type { GeneratedQuery } from "../../../../src/synthetic-datagen/strategies/types.js"
import {
  createCorpus,
  createDocument
} from "../../../../src/types/documents.js"

const content =
  "RAG combines retrieval with generation. It uses relevant documents to answer questions."
const doc = createDocument({ id: "test.md", content })
const corpus = createCorpus([doc])

function makeLLM(response: string): LLMClient {
  return {
    name: "MockLLM",
    async complete() {
      return response
    }
  }
}

describe("GroundTruthAssigner", () => {
  it("should assign valid spans to queries", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: ["RAG combines retrieval with generation"]
      })
    )

    const assigner = new GroundTruthAssigner()
    const queries: GeneratedQuery[] = [
      {
        query: "What does RAG combine?",
        targetDocId: "test.md",
        metadata: {}
      }
    ]

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o"
    })

    expect(results).toHaveLength(1)
    expect(results[0].relevantSpans).toHaveLength(1)
    expect(results[0].relevantSpans[0].start).toBe(0)
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation"
    )
  })

  it("should skip excerpts not found in document", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: ["This text does not exist in the document at all"]
      })
    )

    const assigner = new GroundTruthAssigner()
    const queries: GeneratedQuery[] = [
      { query: "test?", targetDocId: "test.md", metadata: {} }
    ]

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o"
    })

    expect(results).toHaveLength(0)
  })

  it("should return multiple spans when LLM provides multiple excerpts", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: [
          "RAG combines retrieval with generation",
          "It uses relevant documents to answer questions"
        ]
      })
    )

    const assigner = new GroundTruthAssigner()
    const queries: GeneratedQuery[] = [
      { query: "What is RAG?", targetDocId: "test.md", metadata: {} }
    ]

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o"
    })

    expect(results).toHaveLength(1)
    expect(results[0].relevantSpans).toHaveLength(2)
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation"
    )
    expect(results[0].relevantSpans[1].text).toBe(
      "It uses relevant documents to answer questions"
    )
  })

  it("should fuzzy-match excerpts with minor differences", async () => {
    // The excerpt has a small difference ("combines" → "combined") — within 15% threshold
    const llm = makeLLM(
      JSON.stringify({
        excerpts: ["RAG combined retrieval with generation."]
      })
    )

    const assigner = new GroundTruthAssigner()
    const queries: GeneratedQuery[] = [
      { query: "What does RAG do?", targetDocId: "test.md", metadata: {} }
    ]

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o"
    })

    expect(results).toHaveLength(1)
    expect(results[0].relevantSpans.length).toBeGreaterThanOrEqual(1)
    // The span should be from the actual document text, not the LLM's paraphrase
    expect(results[0].relevantSpans[0].text).toContain("RAG combines retrieval")
  })

  it("maps a whitespace-normalized match to the correct span boundary", async () => {
    // The document has a double space ("RAG  combines"); the LLM excerpt uses a
    // single space, so Tier-1 exact misses and Tier-2 normalized matches. The
    // matched region in the original is one char longer than the excerpt, so the
    // old `end = start + excerpt.length` undershoots and drops the final "l".
    const wsDoc = createDocument({
      id: "ws.md",
      content: "RAG  combines retrieval with generation."
    })
    const wsCorpus = createCorpus([wsDoc])
    const llm = makeLLM(
      JSON.stringify({ excerpts: ["RAG combines retrieval"] })
    )

    const assigner = new GroundTruthAssigner()
    const queries: GeneratedQuery[] = [
      { query: "What does RAG combine?", targetDocId: "ws.md", metadata: {} }
    ]

    const results = await assigner.assign(queries, {
      corpus: wsCorpus,
      llmClient: llm,
      model: "gpt-4o"
    })

    expect(results).toHaveLength(1)
    const span = results[0].relevantSpans[0]
    expect(wsDoc.content.slice(span.start, span.end)).toBe(span.text)
    expect(span.text).toBe("RAG  combines retrieval")
  })

  it("does not drop a trailing excerpt fragment lacking terminal punctuation", async () => {
    // Two-part excerpt: a punctuated sentence absent from the doc, then a
    // trailing fragment (no terminal punctuation) that IS in the doc. Tier-1/2
    // miss the combined string, so Tier-3 fuzzy runs; the old tokenizer regex
    // /[^.!?]+[.!?]+/g dropped the unpunctuated trailing fragment, losing its span.
    const fragDoc = createDocument({
      id: "frag.md",
      content:
        "Welcome to the guide. Installation requirements for the system are listed here. Follow each step."
    })
    const fragCorpus = createCorpus([fragDoc])
    const llm = makeLLM(
      JSON.stringify({
        excerpts: [
          "See the appendix elsewhere. Installation requirements for the system"
        ]
      })
    )

    const assigner = new GroundTruthAssigner()
    const queries: GeneratedQuery[] = [
      {
        query: "What are the requirements?",
        targetDocId: "frag.md",
        metadata: {}
      }
    ]

    const results = await assigner.assign(queries, {
      corpus: fragCorpus,
      llmClient: llm,
      model: "gpt-4o"
    })

    // Before the fix the fragment was dropped and no span was attempted, so the
    // query yielded zero spans and was skipped. The fix attempts it; the fuzzy
    // tier's coarse window means the boundary is approximate, but the fragment's
    // distinctive content now appears in a span.
    expect(results).toHaveLength(1)
    const texts = results[0].relevantSpans.map((s) => s.text).join(" ")
    expect(texts).toContain("Installation requirements")
  })

  it("should report failed excerpts without crashing", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: [
          "RAG combines retrieval with generation",
          "Completely unrelated text that is absolutely nowhere in the document whatsoever at all"
        ]
      })
    )

    const assigner = new GroundTruthAssigner()
    const queries: GeneratedQuery[] = [
      { query: "What is RAG?", targetDocId: "test.md", metadata: {} }
    ]

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o"
    })

    // Should still return the one valid span
    expect(results).toHaveLength(1)
    expect(results[0].relevantSpans).toHaveLength(1)
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation"
    )
  })

  it("skips whitespace-only and non-string excerpts", async () => {
    // A whitespace-only excerpt used to yield a phantom 1-char span (indexOf(" ")
    // returns a real offset) and a null excerpt threw on excerpt.length; both must
    // be skipped, leaving only the real span.
    const llm = makeLLM(
      JSON.stringify({
        excerpts: [" ", null, "RAG combines retrieval with generation"]
      })
    )

    const assigner = new GroundTruthAssigner()
    const queries: GeneratedQuery[] = [
      { query: "What is RAG?", targetDocId: "test.md", metadata: {} }
    ]

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o"
    })

    expect(results).toHaveLength(1)
    expect(results[0].relevantSpans).toHaveLength(1)
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation"
    )
  })
})
