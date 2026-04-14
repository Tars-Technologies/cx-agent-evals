import { describe, it, expect } from "vitest";
import {
  parseTranscript,
  parseBotFlowInput,
} from "../../../src/data-analysis/transcript-parser.js";

describe("parseTranscript", () => {
  it("should parse a simple visitor/agent exchange", () => {
    const transcript = "Visitor : Hello || Agent : Hi there";
    const messages = parseTranscript(transcript);
    expect(messages).toEqual([
      { id: 1, role: "user", text: "Hello" },
      { id: 2, role: "human_agent", text: "Hi there" },
    ]);
  });

  it("should parse Unknown as workflow_input", () => {
    const transcript = "Unknown : Assigned to John by Admin";
    const messages = parseTranscript(transcript);
    expect(messages).toEqual([
      { id: 1, role: "workflow_input", text: "Assigned to John by Admin" },
    ]);
  });

  it("should handle multi-message transcripts with all three roles", () => {
    const transcript =
      "Visitor : Hi || Unknown : Assigned to Agent1 by Bot || Agent : Welcome!";
    const messages = parseTranscript(transcript);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ id: 1, role: "user", text: "Hi" });
    expect(messages[1]).toEqual({
      id: 2,
      role: "workflow_input",
      text: "Assigned to Agent1 by Bot",
    });
    expect(messages[2]).toEqual({ id: 3, role: "human_agent", text: "Welcome!" });
  });

  it("should return empty array for empty transcript", () => {
    expect(parseTranscript("")).toEqual([]);
  });

  it("should handle transcript with no delimiters as single message", () => {
    const messages = parseTranscript("Visitor : Just one message");
    expect(messages).toEqual([
      { id: 1, role: "user", text: "Just one message" },
    ]);
  });

  it("should default to workflow_input when speaker prefix is missing", () => {
    const messages = parseTranscript("Some random text without prefix");
    expect(messages).toEqual([
      { id: 1, role: "workflow_input", text: "Some random text without prefix" },
    ]);
  });

  it("should skip whitespace-only segments", () => {
    const transcript = "Visitor : Hello ||  || Agent : Hi";
    const messages = parseTranscript(transcript);
    expect(messages).toEqual([
      { id: 1, role: "user", text: "Hello" },
      { id: 2, role: "human_agent", text: "Hi" },
    ]);
  });

  it("should preserve newlines within message text", () => {
    const transcript = "Agent : Line 1\nLine 2\nLine 3";
    const messages = parseTranscript(transcript);
    expect(messages[0].text).toBe("Line 1\nLine 2\nLine 3");
  });

  it("should handle extra spaces around speaker prefix", () => {
    const transcript = "Visitor  :  Hello there";
    const messages = parseTranscript(transcript);
    expect(messages[0]).toEqual({ id: 1, role: "user", text: "Hello there" });
  });
});

describe("parseBotFlowInput", () => {
  it("should extract intent and language from typical bot flow", () => {
    const result = parseBotFlowInput(
      "Continue in English, -No Input-, New Postpaid Plan, English,"
    );
    expect(result.intent).toBe("New Postpaid Plan");
    expect(result.language).toBe("English");
    expect(result.rawText).toBe(
      "Continue in English, -No Input-, New Postpaid Plan, English,"
    );
  });

  it("should handle Arabic language switch", () => {
    const result = parseBotFlowInput(
      "تبديل إلى العربية, -No Input-, اشتراك شهري جديد, Arabic, , ,"
    );
    expect(result.language).toBe("Arabic");
    expect(result.intent).toBe("اشتراك شهري جديد");
  });

  it("should handle GigaHome intent", () => {
    const result = parseBotFlowInput(
      "Hi, I want to know more about Vodafones GigaHome plans."
    );
    // This doesn't match the comma-separated pattern
    expect(result.intent).toBe("unknown");
    expect(result.language).toBe("unknown");
    expect(result.rawText).toBe(
      "Hi, I want to know more about Vodafones GigaHome plans."
    );
  });

  it("should join multiple intent tokens with /", () => {
    const result = parseBotFlowInput(
      "Continue in English, New Postpaid Plan, Upgrade, English,"
    );
    expect(result.intent).toBe("New Postpaid Plan / Upgrade");
    expect(result.language).toBe("English");
  });

  it("should set unknown when no language found", () => {
    const result = parseBotFlowInput("Some random text");
    expect(result.language).toBe("unknown");
    expect(result.intent).toBe("unknown");
  });

  it("should handle empty string", () => {
    const result = parseBotFlowInput("");
    expect(result.language).toBe("unknown");
    expect(result.intent).toBe("unknown");
    expect(result.rawText).toBe("");
  });
});
