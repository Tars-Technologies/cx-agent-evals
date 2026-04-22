import { describe, it, expect } from "vitest";
import { findCitationSpan } from "../../../../src/synthetic-datagen/unified/citation-validator.js";

const DOC = "Kubernetes pods are the smallest deployable units. Each pod runs one or more containers. Pods share network and storage resources.";

describe("findCitationSpan", () => {
  it("finds exact match", () => {
    const result = findCitationSpan(DOC, "Each pod runs one or more containers.");
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Each pod runs one or more containers.");
    expect(DOC.substring(result!.start, result!.end)).toBe(result!.text);
  });

  it("finds whitespace-normalized match", () => {
    const result = findCitationSpan(DOC, "Each  pod  runs  one or more containers.");
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Each pod runs one or more containers.");
  });

  it("finds fuzzy match with minor word differences", () => {
    const result = findCitationSpan(DOC, "Kubernetes pods are the smallest units.");
    expect(result).not.toBeNull();
    expect(result!.start).toBeLessThanOrEqual(5);
    expect(DOC.includes(result!.text)).toBe(true);
  });

  it("returns null for completely unrelated text", () => {
    const result = findCitationSpan(DOC, "The weather today is sunny and warm.");
    expect(result).toBeNull();
  });

  it("replaces excerpt with actual document text", () => {
    const result = findCitationSpan(DOC, "Each  pod  runs  one or more containers.");
    expect(result).not.toBeNull();
    expect(DOC.includes(result!.text)).toBe(true);
  });

  it("handles case differences", () => {
    const result = findCitationSpan(DOC, "kubernetes pods are the smallest deployable units.");
    expect(result).not.toBeNull();
  });
});
