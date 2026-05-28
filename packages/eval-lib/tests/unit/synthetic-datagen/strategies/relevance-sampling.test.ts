import { describe, expect, it } from "vitest"
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js"
import { buildRelevanceMatrix } from "../../../../src/synthetic-datagen/strategies/dimension-driven/relevance.js"
import { stratifiedSample } from "../../../../src/synthetic-datagen/strategies/dimension-driven/sampling.js"
import type { DocComboAssignment } from "../../../../src/synthetic-datagen/strategies/types.js"
import {
  createCorpus,
  createDocument
} from "../../../../src/types/documents.js"

describe("buildRelevanceMatrix", () => {
  it("should summarize docs and assign combos", async () => {
    const corpus = createCorpus([
      createDocument({ id: "auth.md", content: "Authentication guide..." }),
      createDocument({ id: "pricing.md", content: "Pricing plans..." })
    ])

    const combos = [
      { Persona: "developer", Intent: "troubleshooting" },
      { Persona: "admin", Intent: "comparison" }
    ]

    let callCount = 0
    const llm: LLMClient = {
      name: "MockLLM",
      async complete(params) {
        callCount++
        // First 2 calls are summaries, third is assignment
        if (callCount <= 2) {
          return JSON.stringify({ summary: `Summary for doc ${callCount}` })
        }
        return JSON.stringify({
          assignments: [
            { doc_id: "auth.md", combo_index: 0 },
            { doc_id: "pricing.md", combo_index: 1 }
          ]
        })
      }
    }

    const matrix = await buildRelevanceMatrix(corpus, combos, llm, "gpt-4o")

    expect(matrix.assignments).toHaveLength(2)
    expect(matrix.docSummaries.size).toBe(2)
    expect(matrix.assignments[0].docId).toBe("auth.md")
    expect(matrix.assignments[1].combo).toEqual({
      Persona: "admin",
      Intent: "comparison"
    })
  })
})

describe("stratifiedSample", () => {
  const assignments: DocComboAssignment[] = [
    { docId: "a.md", combo: { P: "new_user", I: "how_to" } },
    { docId: "a.md", combo: { P: "admin", I: "troubleshooting" } },
    { docId: "b.md", combo: { P: "new_user", I: "how_to" } },
    { docId: "b.md", combo: { P: "admin", I: "comparison" } },
    { docId: "c.md", combo: { P: "developer", I: "conceptual" } }
  ]

  it("should return all assignments if budget >= count", () => {
    const result = stratifiedSample(assignments, 10)
    expect(result).toHaveLength(5)
  })

  it("should ensure all documents are represented", () => {
    const result = stratifiedSample(assignments, 3)
    const docIds = new Set(result.map((r) => r.docId))
    expect(docIds.size).toBe(3)
  })

  it("should return empty for empty input", () => {
    expect(stratifiedSample([], 5)).toHaveLength(0)
  })

  it("should respect budget", () => {
    const result = stratifiedSample(assignments, 4)
    expect(result).toHaveLength(4)
  })
})
