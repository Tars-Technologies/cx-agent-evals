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

function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

/**
 * Best-effort content sniff. The caller's `mimeType` is browser-supplied and
 * untrusted, so before we decode bytes as text we reject payloads that are
 * clearly a binary container (a PDF/zip/gzip mislabeled as `text/plain` would
 * otherwise be UTF-8-decoded into U+FFFD garbage and stored as a successful
 * parse). Returns a short label for the detected binary format, or null.
 */
function detectBinaryFormat(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf" // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip" // PK.. (docx/xlsx/zip)
  if (startsWith(bytes, [0x1f, 0x8b])) return "gzip"
  // A NUL byte in the first 8KB is a strong signal the payload is not text.
  const n = Math.min(bytes.length, 8192)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return "binary"
  return null
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
    // Text and HTML are decoded as text, so reject a binary payload here rather
    // than store decoded garbage as a successful parse. `mimeType` is untrusted
    // client input; the magic-byte sniff is the real check.
    if (
      type.includes("html") ||
      type.includes("text") ||
      type.includes("markdown")
    ) {
      const binary = detectBinaryFormat(bytes)
      if (binary) {
        throw new NotSupportedError(
          `parseFile: declared "${mimeType}" but content is ${binary}`,
          this.name
        )
      }
      if (type.includes("html")) {
        const r = await htmlToMarkdown(
          decodeBytes(bytes, sniffHtmlCharset(bytes))
        )
        return { markdown: r.content, title: r.title }
      }
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
