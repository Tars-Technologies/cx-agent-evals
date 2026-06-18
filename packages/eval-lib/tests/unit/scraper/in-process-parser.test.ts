import { describe, expect, it } from "vitest"
import { InProcessParser } from "../../../src/scraper/in-process-parser.js"
import { NotSupportedError } from "../../../src/scraper/ports.js"

const enc = (s: string) => new TextEncoder().encode(s)

describe("InProcessParser", () => {
  it("parses HTML bytes to markdown", async () => {
    const parser = new InProcessParser()
    expect(parser.name).toBe("inprocess")
    const out = await parser.parseFile(
      enc("<html><body><h1>Doc Title</h1><p>Body text</p></body></html>"),
      "text/html"
    )
    expect(out.markdown).toContain("Doc Title")
  })

  it("passes plain text/markdown through unchanged", async () => {
    const out = await new InProcessParser().parseFile(
      enc("# Already Markdown\n\ntext"),
      "text/markdown"
    )
    expect(out.markdown).toBe("# Already Markdown\n\ntext")
  })

  it("throws NotSupportedError for an unsupported mime type", async () => {
    await expect(
      new InProcessParser().parseFile(enc("x"), "application/vnd.ms-excel")
    ).rejects.toBeInstanceOf(NotSupportedError)
  })

  it("startParse throws NotSupportedError (in-process parse is synchronous via parseFile)", async () => {
    await expect(
      new InProcessParser().startParse({
        fileUrl: "https://x/f.pdf",
        mimeType: "application/pdf",
        callbackUrl: "https://cb"
      })
    ).rejects.toBeInstanceOf(NotSupportedError)
  })
})
