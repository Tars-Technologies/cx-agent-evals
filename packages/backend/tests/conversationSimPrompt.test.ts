// packages/backend/tests/conversationSimPrompt.test.ts
import { describe, it, expect } from "vitest";
import { median, p90, wordCount } from "../convex/conversationSim/lengthStats";
import { extractExamples } from "../convex/conversationSim/prompt";
import type { Id } from "../convex/_generated/dataModel";

const TID = "j1234567890abcdef" as Id<"livechatConversations">;

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

describe("extractExamples", () => {
  it("returns empty array when neither field is present", () => {
    expect(extractExamples({})).toEqual([]);
  });

  it("grounded: pairs each user message with preceding human_agent (skipping workflow_input)", () => {
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "human_agent", text: "Welcome! Could I get your name?" },
        { id: 2, role: "user", text: "Syed" },                     // first user msg → skipped (turn-0 opener)
        { id: 3, role: "human_agent", text: "Which plan are you on now?" },
        { id: 4, role: "workflow_input", text: "[event: agent typing]" },
        { id: 5, role: "user", text: "prepaid" },
        { id: 6, role: "human_agent", text: "How can I help?" },
        { id: 7, role: "user", text: "switch number to Vodafone" },
      ],
    });
    expect(out).toEqual([
      { agent: "Which plan are you on now?", user: "prepaid" },
      { agent: "How can I help?", user: "switch number to Vodafone" },
    ]);
  });

  it("grounded: emits agent: null when user spoke first AND there are no other user messages", () => {
    // Skip-first rule still applies; one-user-message transcript yields zero examples.
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "user", text: "hi" },
      ],
    });
    expect(out).toEqual([]);
  });

  it("grounded: emits agent: null for user messages that have no preceding human_agent", () => {
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "human_agent", text: "Hello!" },
        { id: 2, role: "user", text: "Hi" },                       // skipped (first)
        { id: 3, role: "user", text: "I have a question" },        // no preceding human_agent in between
      ],
    });
    expect(out).toEqual([
      { agent: null, user: "I have a question" },
    ]);
  });

  it("grounded: caps at 8 examples sorted by user-message brevity ascending", () => {
    const messages = [
      { id: 1, role: "human_agent" as const, text: "Q0" },
      { id: 2, role: "user" as const, text: "first message" },     // skipped (first user msg)
      // Now 9 more agent/user pairs with varying user lengths
      ...Array.from({ length: 9 }, (_, i) => [
        { id: 100 + 2 * i, role: "human_agent" as const, text: `Q${i + 1}` },
        // Word counts: 10, 9, 8, 7, 6, 5, 4, 3, 2
        { id: 101 + 2 * i, role: "user" as const, text: Array(10 - i).fill("w").join(" ") },
      ]).flat(),
    ];
    const out = extractExamples({ referenceTranscript: messages });
    expect(out).toHaveLength(8);
    // Shortest first: 2-word reply should be first
    expect(out[0].user.split(/\s+/).length).toBe(2);
    expect(out[7].user.split(/\s+/).length).toBe(9);
  });

  it("synthetic: flattens exemplars into the same shape", () => {
    const out = extractExamples({
      referenceExemplars: [
        {
          sourceTranscriptId: TID,
          messages: [
            { id: 5, role: "human_agent", text: "What's your name?" },
            { id: 6, role: "user", text: "Ahmed" },
          ],
        },
        {
          sourceTranscriptId: TID,
          messages: [
            { id: 8, role: "human_agent", text: "Which plan?" },
            { id: 9, role: "workflow_input", text: "[typing]" },
            { id: 10, role: "user", text: "prepaid" },
          ],
        },
      ],
    });
    expect(out).toEqual([
      { agent: "What's your name?", user: "Ahmed" },
      { agent: "Which plan?", user: "prepaid" },
    ]);
  });

  it("synthetic: emits agent: null for exemplar with no preceding human_agent", () => {
    const out = extractExamples({
      referenceExemplars: [
        {
          sourceTranscriptId: TID,
          messages: [{ id: 1, role: "user", text: "hello" }],
        },
      ],
    });
    expect(out).toEqual([{ agent: null, user: "hello" }]);
  });

  it("prefers referenceTranscript when both fields are present (defensive)", () => {
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "human_agent", text: "Q1" },
        { id: 2, role: "user", text: "u1" },                       // skipped (first user)
        { id: 3, role: "human_agent", text: "Q2" },
        { id: 4, role: "user", text: "u2" },
      ],
      referenceExemplars: [
        { sourceTranscriptId: TID, messages: [{ id: 1, role: "user", text: "ignored" }] },
      ],
    });
    expect(out).toEqual([{ agent: "Q2", user: "u2" }]);
  });
});
