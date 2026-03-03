import { htmlToMarkdown, type FileProcessorConfig, type ProcessedDocument } from "./html-to-markdown.js";
import { pdfToMarkdown } from "./pdf-to-markdown.js";

export type { FileProcessorConfig, ProcessedDocument };

type ProcessFileInput =
  | { content: string; format: "html"; baseUrl?: string }
  | { buffer: Buffer; format: "pdf" }
  | { content: string; format: "markdown" };

export async function processFile(
  input: ProcessFileInput,
  config?: FileProcessorConfig,
): Promise<ProcessedDocument> {
  switch (input.format) {
    case "html":
      return htmlToMarkdown(input.content, {
        ...config,
        baseUrl: input.baseUrl ?? config?.baseUrl,
      });

    case "pdf":
      return pdfToMarkdown(input.buffer);

    case "markdown": {
      const content = input.content.replace(/\n{3,}/g, "\n\n").trim();
      const headingMatch = content.match(/^#\s+(.+)$/m);
      const title = headingMatch?.[1]?.trim() ?? "";
      const wordCount = content
        ? content.split(/\s+/).filter((w) => w.length > 0).length
        : 0;

      return {
        content,
        title,
        metadata: { sourceFormat: "markdown", wordCount },
      };
    }

    default:
      throw new Error(`Unsupported format: ${(input as any).format}`);
  }
}
