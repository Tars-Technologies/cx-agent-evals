import { describe, expect, it } from "vitest"
import { processFile } from "../../../src/file-processing/processor.js"

describe("processFile", () => {
  it("processes HTML input", async () => {
    const result = await processFile({
      content: "<html><body><h1>Test</h1><p>Hello world</p></body></html>",
      format: "html"
    })
    expect(result.content).toContain("Test")
    expect(result.metadata.sourceFormat).toBe("html")
    expect(result.metadata.wordCount).toBeGreaterThan(0)
  })

  it("processes markdown input (passthrough with cleanup)", async () => {
    const result = await processFile({
      content: "# Title\n\n\n\nSome content here   ",
      format: "markdown"
    })
    expect(result.content).toBe("# Title\n\nSome content here")
    expect(result.metadata.sourceFormat).toBe("markdown")
    expect(result.title).toBe("Title")
  })

  it("extracts links from HTML", async () => {
    const result = await processFile({
      content:
        '<html><body><a href="https://example.com">Link</a></body></html>',
      format: "html",
      baseUrl: "https://example.com"
    })
    expect(result.metadata.links).toContain("https://example.com/")
  })
})
