import { describe, it, expect } from "vitest";
import { splitIntoSegments } from "../../../src/chunkers/segment-utils.js";

describe("splitIntoSegments", () => {
  it("splits text into segments of approximately segmentSize chars", () => {
    const text = "Hello world this is a test of segment splitting logic here";
    const segments = splitIntoSegments(text, 20);

    // Each segment should be roughly 20 chars, broken at word boundaries
    for (const seg of segments) {
      expect(seg.text.length).toBeLessThanOrEqual(25); // some slack for word boundaries
      expect(seg.text.length).toBeGreaterThan(0);
    }
  });

  it("tracks character positions correctly", () => {
    const text = "Hello world this is a test";
    const segments = splitIntoSegments(text, 12);

    for (const seg of segments) {
      expect(text.slice(seg.start, seg.end)).toBe(seg.text);
    }
  });

  it("covers the entire text without gaps", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const segments = splitIntoSegments(text, 10);

    // First segment starts at 0
    expect(segments[0]!.start).toBe(0);
    // Last segment ends at text.length
    expect(segments[segments.length - 1]!.end).toBe(text.length);
    // No gaps between segments
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.start).toBe(segments[i - 1]!.end);
    }
  });

  it("returns single segment for short text", () => {
    const text = "Short";
    const segments = splitIntoSegments(text, 50);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ text: "Short", start: 0, end: 5 });
  });

  it("returns empty array for empty text", () => {
    expect(splitIntoSegments("", 50)).toEqual([]);
  });

  it("handles text shorter than segmentSize", () => {
    const text = "Hello";
    const segments = splitIntoSegments(text, 100);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("Hello");
  });

  it("handles text with no spaces (cannot break at word boundary)", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const segments = splitIntoSegments(text, 10);

    // Should still split, just not at word boundaries
    expect(segments.length).toBeGreaterThan(1);
    for (const seg of segments) {
      expect(text.slice(seg.start, seg.end)).toBe(seg.text);
    }
  });
});
