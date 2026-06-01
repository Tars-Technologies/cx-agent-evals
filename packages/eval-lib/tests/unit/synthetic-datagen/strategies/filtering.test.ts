import { describe, expect, it } from "vitest"
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js"
import { filterCombinations } from "../../../../src/synthetic-datagen/strategies/dimension-driven/filtering.js"
import type { Dimension } from "../../../../src/synthetic-datagen/strategies/types.js"

const dimensions: Dimension[] = [
  { name: "Persona", description: "User type", values: ["new_user", "admin"] },
  {
    name: "Complexity",
    description: "Question depth",
    values: ["basic", "advanced"]
  }
]

describe("filterCombinations", () => {
  it("should filter out unrealistic pairwise combinations", async () => {
    const llm: LLMClient = {
      name: "MockLLM",
      async complete() {
        return JSON.stringify({
          unrealistic_pairs: [
            { dim_a_value: "new_user", dim_b_value: "advanced" }
          ]
        })
      }
    }

    const combos = await filterCombinations(dimensions, llm, "gpt-4o")

    // 4 total combos, 1 filtered out (new_user × advanced)
    expect(combos).toHaveLength(3)
    expect(
      combos.some(
        (c) => c["Persona"] === "new_user" && c["Complexity"] === "advanced"
      )
    ).toBe(false)
    expect(
      combos.some(
        (c) => c["Persona"] === "new_user" && c["Complexity"] === "basic"
      )
    ).toBe(true)
    expect(
      combos.some(
        (c) => c["Persona"] === "admin" && c["Complexity"] === "advanced"
      )
    ).toBe(true)
  })

  it("should keep all combos if nothing is unrealistic", async () => {
    const llm: LLMClient = {
      name: "MockLLM",
      async complete() {
        return JSON.stringify({ unrealistic_pairs: [] })
      }
    }

    const combos = await filterCombinations(dimensions, llm, "gpt-4o")
    expect(combos).toHaveLength(4)
  })

  it("should handle 3+ dimensions with pairwise filtering", async () => {
    const dims3: Dimension[] = [
      ...dimensions,
      { name: "Tone", description: "Formality", values: ["casual", "formal"] }
    ]

    const llm: LLMClient = {
      name: "MockLLM",
      async complete() {
        // No filtering — all pairs are realistic
        return JSON.stringify({ unrealistic_pairs: [] })
      }
    }

    const combos = await filterCombinations(dims3, llm, "gpt-4o")
    // 2 × 2 × 2 = 8
    expect(combos).toHaveLength(8)
  })
})
