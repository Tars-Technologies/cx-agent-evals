import { describe, expect, it } from "vitest"
import { computeIndexConfigHash } from "../../../../src/retrievers/pipeline/config.js"

// Hashes recorded BEFORE vectorBackend/embeddingProvider existed. These must
// NEVER change for configs that don't set the new fields, because existing
// indexed chunks are keyed by them.
const LOCKED = {
  plainDefaults:
    "93cc13c38a727a9a2ccb180b5cc62ae92911cf023b854c8320b2055b9ddcff6c",
  plainExplicit:
    "31bda18071d6c16cd91753b7bea997f12e2b72f2d79c8393994354fbf3f00c6f",
  contextual:
    "329ae6af99b69826f720368cbbb09779c84fa729851b849d3e90f8ef20a231ff",
  summary: "86f05e0a6b3d03ca1cea09195bb7db4a1286b2bae87d62b48d75e977c41a2fc1",
  parentChild:
    "10a8fa930f33a8763c7dec403dfbedf5a14ac0398f482c82bec66b6909694fb7",
  noIndex: "93cc13c38a727a9a2ccb180b5cc62ae92911cf023b854c8320b2055b9ddcff6c"
} as const

describe("indexConfigHash preservation", () => {
  it("legacy configs hash identically (no new-field leakage)", () => {
    expect(
      computeIndexConfigHash({ name: "t", index: { strategy: "plain" } })
    ).toBe(LOCKED.plainDefaults)
    expect(
      computeIndexConfigHash({
        name: "t",
        index: {
          strategy: "plain",
          chunkSize: 500,
          chunkOverlap: 50,
          embeddingModel: "text-embedding-3-small"
        }
      })
    ).toBe(LOCKED.plainExplicit)
    expect(
      computeIndexConfigHash({ name: "t", index: { strategy: "contextual" } })
    ).toBe(LOCKED.contextual)
    expect(
      computeIndexConfigHash({ name: "t", index: { strategy: "summary" } })
    ).toBe(LOCKED.summary)
    expect(
      computeIndexConfigHash({
        name: "t",
        index: { strategy: "parent-child", childChunkSize: 200 }
      })
    ).toBe(LOCKED.parentChild)
    expect(computeIndexConfigHash({ name: "t" })).toBe(LOCKED.noIndex)
  })

  it("explicit defaults are omitted (native/openai hash like legacy)", () => {
    expect(
      computeIndexConfigHash({
        name: "t",
        index: {
          strategy: "plain",
          vectorBackend: "native",
          embeddingProvider: "openai"
        }
      })
    ).toBe(LOCKED.plainDefaults)
  })

  it("qdrant / non-openai produce NEW hashes", () => {
    const qdrant = computeIndexConfigHash({
      name: "t",
      index: { strategy: "plain", vectorBackend: "qdrant" }
    })
    const cohere = computeIndexConfigHash({
      name: "t",
      index: { strategy: "plain", embeddingProvider: "cohere" }
    })
    expect(qdrant).not.toBe(LOCKED.plainDefaults)
    expect(cohere).not.toBe(LOCKED.plainDefaults)
    expect(qdrant).not.toBe(cohere)
  })
})
