import { htmlToMarkdown } from "../file-processing/html-to-markdown.js"
import { pdfToMarkdown } from "../file-processing/pdf-to-markdown.js"
import type { ParsedFile, Parser, ParseOptions } from "./ports.js"
import { NotSupportedError } from "./ports.js"

/**
 * In-process parser. Converts uploaded file bytes to markdown synchronously by
 * mime type. The async startParse() is unsupported here: in-process parsing returns
 * markdown directly via parseFile(); only the remote (Tarser) parser uses callbacks.
 */
export class InProcessParser implements Parser {
  readonly name = "inprocess"

  async checkHealth(): Promise<boolean> {
    return true
  }

  async parseFile(bytes: Uint8Array, mimeType: string): Promise<ParsedFile> {
    const type = mimeType.toLowerCase()
    if (type.includes("pdf")) {
      const r = await pdfToMarkdown(Buffer.from(bytes))
      return { markdown: r.content, title: r.title }
    }
    if (type.includes("html")) {
      const r = await htmlToMarkdown(new TextDecoder().decode(bytes))
      return { markdown: r.content, title: r.title }
    }
    if (type.includes("text") || type.includes("markdown")) {
      return { markdown: new TextDecoder().decode(bytes) }
    }
    throw new NotSupportedError(`parseFile(${mimeType})`, this.name)
  }

  async startParse(_args: {
    fileUrl: string
    mimeType: string
    options?: ParseOptions
    callbackUrl: string
  }): Promise<{ serviceJobId: string }> {
    throw new NotSupportedError("startParse", this.name)
  }

  async cancel(_serviceJobId: string): Promise<void> {
    // No remote job; in-process parse is synchronous.
  }
}
