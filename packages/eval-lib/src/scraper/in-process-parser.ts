import { htmlToMarkdown } from "../file-processing/html-to-markdown.js"
import { pdfToMarkdown } from "../file-processing/pdf-to-markdown.js"
import type {
  ParsedFile,
  ParseOptions,
  Parser,
  ParserJobResult,
  ScraperJobResult
} from "./ports.js"
import { NotSupportedError } from "./ports.js"

function sniffHtmlCharset(bytes: Uint8Array): string {
  // Read only the first 1024 bytes as ASCII (safe regardless of encoding) to find
  // the charset declaration before we commit to a full decode.
  const head = new TextDecoder("ascii", { fatal: false }).decode(
    bytes.subarray(0, 1024)
  )
  const m = head.match(/charset=["']?([\w-]+)/i)
  return m?.[1] ?? "utf-8"
}

function decodeBytes(bytes: Uint8Array, charset = "utf-8"): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}
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
      const r = await htmlToMarkdown(
        decodeBytes(bytes, sniffHtmlCharset(bytes))
      )
      return { markdown: r.content, title: r.title }
    }
    if (type.includes("text") || type.includes("markdown")) {
      return { markdown: decodeBytes(bytes) }
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

  async getResult(
    _serviceJobId: string,
    _expectedKind?: "crawl" | "parse"
  ): Promise<ScraperJobResult | ParserJobResult> {
    // In-process parsing is synchronous (parseFile); there is no polled job to drain.
    throw new NotSupportedError("getResult", this.name)
  }
}
