import { describe, it, expect } from "vitest";
import type {
  JobStatus,
  SerializedSpan,
  ExperimentResult,
} from "../../src/shared/index.js";
import {
  EMBED_BATCH_SIZE,
  CLEANUP_BATCH_SIZE,
  QUESTION_INSERT_BATCH_SIZE,
  TIER_PARALLELISM,
} from "../../src/shared/index.js";

describe("shared/types", () => {
  it("JobStatus accepts valid statuses", () => {
    const statuses: JobStatus[] = [
      "pending",
      "running",
      "completed",
      "completed_with_errors",
      "failed",
      "canceling",
      "canceled",
    ];
    expect(statuses).toHaveLength(7);
  });

  it("SerializedSpan has correct shape", () => {
    const span: SerializedSpan = {
      docId: "doc1",
      start: 0,
      end: 10,
      text: "hello",
    };
    expect(span.docId).toBe("doc1");
    expect(span.start).toBe(0);
    expect(span.end).toBe(10);
    expect(span.text).toBe("hello");
  });

  it("ExperimentResult has correct shape", () => {
    const result: ExperimentResult = {
      query: "test query",
      retrievedSpans: [{ docId: "doc1", start: 0, end: 10, text: "hello" }],
      scores: { recall: 0.5, precision: 0.8 },
    };
    expect(result.query).toBe("test query");
    expect(result.retrievedSpans).toHaveLength(1);
    expect(result.scores.recall).toBe(0.5);
    expect(result.scores.precision).toBe(0.8);
  });
});

describe("shared/constants", () => {
  it("EMBED_BATCH_SIZE is a positive number", () => {
    expect(EMBED_BATCH_SIZE).toBe(50);
  });

  it("CLEANUP_BATCH_SIZE is a positive number", () => {
    expect(CLEANUP_BATCH_SIZE).toBe(100);
  });

  it("QUESTION_INSERT_BATCH_SIZE is a positive number", () => {
    expect(QUESTION_INSERT_BATCH_SIZE).toBe(100);
  });

  it("TIER_PARALLELISM has free, pro, enterprise tiers", () => {
    expect(TIER_PARALLELISM.free).toBe(3);
    expect(TIER_PARALLELISM.pro).toBe(10);
    expect(TIER_PARALLELISM.enterprise).toBe(20);
  });
});
