import { htmlToMarkdown } from "./html-to-markdown.js"
import { pdfToMarkdown } from "./pdf-to-markdown.js"

export interface FileProcessorConfig {
  onlyMainContent?: boolean
}

export interface ProcessedDocument {
  content: string
  title: string
  metadata: {
    sourceFormat: "html" | "pdf" | "markdown"
    wordCount: number
    links?: string[]
  }
}

type FileInput =
  | { content: string; format: "html"; baseUrl?: string }
  | { buffer: Buffer; format: "pdf" }
  | { content: string; format: "markdown" }

export async function processFile(
  input: FileInput,
  config?: FileProcessorConfig
): Promise<ProcessedDocument> {
  if (input.format === "html") {
    const result = await htmlToMarkdown(input.content, {
      onlyMainContent: config?.onlyMainContent ?? true,
      baseUrl: input.baseUrl
    })
    return {
      content: result.content,
      title: result.title,
      metadata: {
        sourceFormat: "html",
        wordCount: countWords(result.content),
        links: result.links
      }
    }
  }
  if (input.format === "pdf") {
    const result = await pdfToMarkdown(input.buffer)
    return {
      content: result.content,
      title: result.title,
      metadata: { sourceFormat: "pdf", wordCount: countWords(result.content) }
    }
  }
  const content = input.content
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim()
  const titleMatch = content.match(/^#\s+(.+)$/m)
  return {
    content,
    title: titleMatch?.[1]?.trim() || "",
    metadata: { sourceFormat: "markdown", wordCount: countWords(content) }
  }
}

function countWords(text: string): number {
  return text
    .replace(/[#*_`~[\]()>-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length
}
