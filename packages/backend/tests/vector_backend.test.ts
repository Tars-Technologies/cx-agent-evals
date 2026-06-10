import { describe, expect, it } from "vitest"
import {
  qdrantCollectionName,
  resolveVectorBackend
} from "../convex/kb/vector_backend"

describe("resolveVectorBackend", () => {
  it("returns qdrant only for the exact 'qdrant' value", () => {
    expect(resolveVectorBackend("qdrant")).toBe("qdrant")
  })

  it("defaults everything else to native", () => {
    expect(resolveVectorBackend("native")).toBe("native")
    expect(resolveVectorBackend(undefined)).toBe("native")
    expect(resolveVectorBackend(null)).toBe("native")
    expect(resolveVectorBackend("")).toBe("native")
    expect(resolveVectorBackend("Qdrant")).toBe("native")
    expect(resolveVectorBackend(42)).toBe("native")
  })
})

describe("qdrantCollectionName", () => {
  it("builds kb_<kbId>_<first 16 hash chars>", () => {
    const hash = "abcdef0123456789deadbeef"
    expect(qdrantCollectionName("kb123", hash)).toBe(
      `kb_kb123_${hash.slice(0, 16)}`
    )
  })

  it("is deterministic for the same inputs", () => {
    expect(qdrantCollectionName("k", "h".repeat(64))).toBe(
      qdrantCollectionName("k", "h".repeat(64))
    )
  })

  it("keeps short hashes intact", () => {
    expect(qdrantCollectionName("kb", "short")).toBe("kb_kb_short")
  })
})
