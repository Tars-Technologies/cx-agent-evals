import { describe, it, expect } from "vitest";
import {
  deserializeSpans,
  createLangSmithEvaluator,
  DEFAULT_METRICS,
} from "../../src/langsmith/experiment.js";
import { recall } from "../../src/evaluation/metrics/recall.js";

describe("langsmith/experiment", () => {
  describe("deserializeSpans", () => {
    it("converts raw span objects to CharacterSpan[]", () => {
      const raw = [
        { docId: "doc1", start: 0, end: 10, text: "hello" },
        { docId: "doc2", start: 5, end: 15, text: "world" },
      ];
      const spans = deserializeSpans(raw);
      expect(spans).toHaveLength(2);
      expect(String(spans[0].docId)).toBe("doc1");
      expect(spans[0].start).toBe(0);
      expect(spans[0].end).toBe(10);
      expect(spans[0].text).toBe("hello");
    });

    it("preserves all fields from each span", () => {
      const raw = [{ docId: "myDoc", start: 100, end: 200, text: "content" }];
      const spans = deserializeSpans(raw);
      expect(spans).toHaveLength(1);
      expect(String(spans[0].docId)).toBe("myDoc");
      expect(spans[0].start).toBe(100);
      expect(spans[0].end).toBe(200);
      expect(spans[0].text).toBe("content");
    });

    it("returns empty array for null input", () => {
      expect(deserializeSpans(null)).toEqual([]);
    });

    it("returns empty array for undefined input", () => {
      expect(deserializeSpans(undefined)).toEqual([]);
    });

    it("returns empty array for string input", () => {
      expect(deserializeSpans("string")).toEqual([]);
    });

    it("returns empty array for number input", () => {
      expect(deserializeSpans(42)).toEqual([]);
    });

    it("returns empty array for object input", () => {
      expect(deserializeSpans({ notAnArray: true })).toEqual([]);
    });

    it("handles empty array input", () => {
      expect(deserializeSpans([])).toEqual([]);
    });
  });

  describe("createLangSmithEvaluator", () => {
    it("creates an evaluator that computes metric score", () => {
      const evaluator = createLangSmithEvaluator(recall);
      const result = evaluator({
        outputs: {
          relevantSpans: [
            { docId: "doc1", start: 0, end: 10, text: "hello" },
          ],
        },
        referenceOutputs: {
          relevantSpans: [
            { docId: "doc1", start: 0, end: 10, text: "hello" },
          ],
        },
      });
      expect(result.key).toBe("recall");
      expect(result.score).toBe(1);
    });

    it("returns 0 score when there is no overlap", () => {
      const evaluator = createLangSmithEvaluator(recall);
      const result = evaluator({
        outputs: {
          relevantSpans: [
            { docId: "doc1", start: 100, end: 200, text: "x".repeat(100) },
          ],
        },
        referenceOutputs: {
          relevantSpans: [
            { docId: "doc1", start: 0, end: 10, text: "hello" },
          ],
        },
      });
      expect(result.key).toBe("recall");
      expect(result.score).toBe(0);
    });

    it("handles missing outputs gracefully", () => {
      const evaluator = createLangSmithEvaluator(recall);
      const result = evaluator({
        outputs: undefined,
        referenceOutputs: undefined,
      });
      // Both empty => recall is 1.0 (vacuous truth)
      expect(result.key).toBe("recall");
      expect(result.score).toBe(1);
    });

    it("handles missing relevantSpans in outputs", () => {
      const evaluator = createLangSmithEvaluator(recall);
      const result = evaluator({
        outputs: {},
        referenceOutputs: {
          relevantSpans: [
            { docId: "doc1", start: 0, end: 10, text: "hello" },
          ],
        },
      });
      expect(result.key).toBe("recall");
      expect(result.score).toBe(0);
    });
  });

  describe("DEFAULT_METRICS", () => {
    it("includes recall, precision, iou, f1", () => {
      expect(DEFAULT_METRICS).toHaveLength(4);
      const names = DEFAULT_METRICS.map((m) => m.name);
      expect(names).toContain("recall");
      expect(names).toContain("precision");
      expect(names).toContain("iou");
      expect(names).toContain("f1");
    });
  });
});
