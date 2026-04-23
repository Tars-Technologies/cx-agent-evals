import { describe, it, expect } from "vitest";
import { parseJudgeResponse } from "../convex/evaluator/parseJudge";

describe("parseJudgeResponse", () => {
  describe("well-formed JSON", () => {
    it("returns pass for answer=pass", () => {
      const r = parseJudgeResponse(
        JSON.stringify({ answer: "Pass", reasoning: "Clear and complete" }),
      );
      expect(r.verdict).toBe("pass");
      expect(r.reasoning).toBe("Clear and complete");
    });

    it("returns fail for answer=fail", () => {
      const r = parseJudgeResponse(
        JSON.stringify({ answer: "Fail", reasoning: "Missed key info" }),
      );
      expect(r.verdict).toBe("fail");
      expect(r.reasoning).toBe("Missed key info");
    });

    it("accepts verdict as alternate key name", () => {
      const r = parseJudgeResponse(
        JSON.stringify({ verdict: "pass", explanation: "Good" }),
      );
      expect(r.verdict).toBe("pass");
      expect(r.reasoning).toBe("Good");
    });

    it("accepts yes/no as aliases for pass/fail", () => {
      expect(parseJudgeResponse(JSON.stringify({ answer: "yes" })).verdict).toBe(
        "pass",
      );
      expect(parseJudgeResponse(JSON.stringify({ answer: "no" })).verdict).toBe(
        "fail",
      );
    });

    it("is case-insensitive on the answer value", () => {
      expect(parseJudgeResponse(JSON.stringify({ answer: "PASS" })).verdict).toBe(
        "pass",
      );
      expect(parseJudgeResponse(JSON.stringify({ answer: "Fail " })).verdict).toBe(
        "fail",
      );
    });
  });

  describe("JSON wrapped in other content", () => {
    it("extracts JSON from a markdown code fence", () => {
      const content = `Here's my evaluation:

\`\`\`json
{"answer": "Pass", "reasoning": "Concise answer"}
\`\`\``;
      const r = parseJudgeResponse(content);
      expect(r.verdict).toBe("pass");
      expect(r.reasoning).toBe("Concise answer");
    });

    it("extracts JSON embedded in prose", () => {
      const content = `Let me evaluate. {"reasoning": "Good", "answer": "pass"} Done.`;
      const r = parseJudgeResponse(content);
      expect(r.verdict).toBe("pass");
    });
  });

  describe("error cases (previously silently mislabeled)", () => {
    it("throws on a refusal containing the word 'pass' (the old bug)", () => {
      // This was the exact regression: "I cannot pass judgment" used to return pass
      expect(() =>
        parseJudgeResponse("I cannot pass judgment on this question"),
      ).toThrow(/Unparseable judge response/);
    });

    it("throws on empty content", () => {
      expect(() => parseJudgeResponse("")).toThrow(/Unparseable judge response/);
    });

    it("throws on plain text with no verdict marker", () => {
      expect(() => parseJudgeResponse("The answer looks fine to me.")).toThrow(
        /Unparseable judge response/,
      );
    });

    it("throws when JSON parses but has no recognized answer value", () => {
      expect(() =>
        parseJudgeResponse(JSON.stringify({ answer: "maybe" })),
      ).toThrow(/Unparseable judge response/);
    });

    it("throws when JSON parses but is not an object", () => {
      expect(() => parseJudgeResponse("42")).toThrow(/Unparseable judge response/);
      expect(() => parseJudgeResponse("null")).toThrow(
        /Unparseable judge response/,
      );
    });

    it("throws on malformed JSON that contains 'pass' substring", () => {
      // Old fallback would have mislabeled this as pass
      expect(() =>
        parseJudgeResponse('{"answer": "pass", broken json'),
      ).toThrow(/Unparseable judge response/);
    });
  });

  describe("truncation in error message", () => {
    it("truncates very long responses in the thrown error", () => {
      const longContent = "x".repeat(500);
      try {
        parseJudgeResponse(longContent);
      } catch (e) {
        expect((e as Error).message.length).toBeLessThan(400);
      }
    });
  });
});
