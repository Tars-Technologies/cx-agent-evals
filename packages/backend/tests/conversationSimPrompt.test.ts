// packages/backend/tests/conversationSimPrompt.test.ts
import { describe, it, expect } from "vitest";
import { median, p90, wordCount } from "../convex/conversationSim/lengthStats";

describe("lengthStats", () => {
  describe("wordCount", () => {
    it("counts words in a normal string", () => {
      expect(wordCount("Hi I want to switch")).toBe(5);
    });
    it("treats multiple whitespace as one separator", () => {
      expect(wordCount("Hi   I  want")).toBe(3);
    });
    it("returns 0 for empty string", () => {
      expect(wordCount("")).toBe(0);
    });
    it("returns 0 for whitespace-only string", () => {
      expect(wordCount("   \n\t  ")).toBe(0);
    });
  });

  describe("median", () => {
    it("computes median for odd-length sorted array", () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3);
    });
    it("computes median for even-length sorted array", () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });
    it("works on unsorted input", () => {
      expect(median([5, 1, 3, 2, 4])).toBe(3);
    });
    it("throws on empty array", () => {
      expect(() => median([])).toThrow();
    });
  });

  describe("p90", () => {
    it("computes p90 for a 10-element array", () => {
      // Sorted: [1..10]; ceil(10*0.9)=9; index 8 (0-based) = 9
      expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    });
    it("returns the max for very small arrays", () => {
      expect(p90([5, 10])).toBe(10);
    });
    it("throws on empty array", () => {
      expect(() => p90([])).toThrow();
    });
  });
});
