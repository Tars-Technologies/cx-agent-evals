import { describe, expect, it } from "vitest"
import { findCitationSpan } from "../../../../src/synthetic-datagen/unified/citation-validator.js"

const DOC =
  "Kubernetes pods are the smallest deployable units. Each pod runs one or more containers. Pods share network and storage resources."

describe("findCitationSpan", () => {
  it("finds exact match", () => {
    const result = findCitationSpan(
      DOC,
      "Each pod runs one or more containers."
    )
    expect(result).not.toBeNull()
    expect(result!.text).toBe("Each pod runs one or more containers.")
    expect(DOC.substring(result!.start, result!.end)).toBe(result!.text)
  })

  it("finds whitespace-normalized match", () => {
    const result = findCitationSpan(
      DOC,
      "Each  pod  runs  one or more containers."
    )
    expect(result).not.toBeNull()
    expect(result!.text).toBe("Each pod runs one or more containers.")
  })

  it("finds fuzzy match with minor word differences", () => {
    const result = findCitationSpan(
      DOC,
      "Kubernetes pods are the smallest units."
    )
    expect(result).not.toBeNull()
    expect(result!.start).toBeLessThanOrEqual(5)
    expect(DOC.includes(result!.text)).toBe(true)
  })

  it("returns null for completely unrelated text", () => {
    const result = findCitationSpan(DOC, "The weather today is sunny and warm.")
    expect(result).toBeNull()
  })

  it("returns null for an empty excerpt", () => {
    // Without the guard, Tier-1 indexOf("") returns 0 and yields a phantom
    // zero-length span {0,0,""} that evades the spans>0 filter and inflates
    // recall to 1.0 for every retriever (GEN-1).
    expect(findCitationSpan(DOC, "")).toBeNull()
  })

  it("returns null for a whitespace-only excerpt", () => {
    expect(findCitationSpan(DOC, "   \n\t  ")).toBeNull()
  })

  it("replaces excerpt with actual document text", () => {
    const result = findCitationSpan(
      DOC,
      "Each  pod  runs  one or more containers."
    )
    expect(result).not.toBeNull()
    expect(DOC.includes(result!.text)).toBe(true)
  })

  it("handles case differences", () => {
    const result = findCitationSpan(
      DOC,
      "kubernetes pods are the smallest deployable units."
    )
    expect(result).not.toBeNull()
  })

  it("refines the fuzzy window to the true citation boundary", () => {
    // The doc's phrasing differs from the citation by one character ("fix" vs
    // "fox"), so Tier-1 and Tier-2 miss and Tier-3 runs. The target begins at an
    // offset that the coarse sliding-window stride never samples exactly, so
    // without the local stride-1 refine the returned span is bounded to the
    // nearest coarse step and includes/loses boundary characters.
    const target = "the quick brown fix jumps over the lazy dog tonight"
    const doc = `xxxxxxx${target} and then everyone went home to rest.`
    const result = findCitationSpan(
      doc,
      "the quick brown fox jumps over the lazy dog tonight"
    )
    expect(result).not.toBeNull()
    expect(doc.slice(result!.start, result!.end)).toBe(result!.text)
    expect(result!.text).toBe(target)
  })
})
