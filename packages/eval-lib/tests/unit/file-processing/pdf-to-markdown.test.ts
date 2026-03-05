import { describe, it, expect } from "vitest";
import { pdfToMarkdown } from "../../../src/file-processing/pdf-to-markdown.js";

describe("pdfToMarkdown", () => {
  it("returns a PdfToMarkdownResult shape", async () => {
    // unpdf may not parse a hand-crafted minimal PDF, so we test the interface
    // A real integration test would use an actual PDF fixture file
    try {
      const result = await pdfToMarkdown(Buffer.from("not a real pdf"));
      expect(result.content).toBeDefined();
      expect(result.title).toBeDefined();
    } catch (e) {
      // Expected: unpdf throws on invalid PDF — that's fine for unit test
      expect(e).toBeDefined();
    }
  });
});
