import { describe, it, expect } from "vitest";
import { processFile } from "../../../src/file-processing/processor.js";

describe("processFile", () => {
  it("should dispatch HTML input to htmlToMarkdown", async () => {
    const result = await processFile({
      content: "<html><head><title>Test</title></head><body><article><h1>Hello</h1><p>World</p></article></body></html>",
      format: "html",
    });

    expect(result.content).toContain("Hello");
    expect(result.metadata.sourceFormat).toBe("html");
  });

  it("should handle raw markdown input with cleanup", async () => {
    const result = await processFile({
      content: "# Title\n\n\n\n\nParagraph with   extra   spaces.\n\n\n\nEnd.",
      format: "markdown",
    });

    expect(result.content).toBe("# Title\n\nParagraph with   extra   spaces.\n\nEnd.");
    expect(result.metadata.sourceFormat).toBe("markdown");
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });

  it("should extract title from markdown first heading", async () => {
    const result = await processFile({
      content: "# My Document\n\nSome content here.",
      format: "markdown",
    });

    expect(result.title).toBe("My Document");
  });

  it("should dispatch PDF buffer to pdfToMarkdown", async () => {
    const result = await processFile({
      buffer: Buffer.alloc(0),
      format: "pdf",
    });

    expect(result.content).toBe("");
    expect(result.metadata.sourceFormat).toBe("pdf");
  });
});
