import { extractText } from "unpdf";

export interface PdfToMarkdownResult {
  content: string;
  title: string;
}

export async function pdfToMarkdown(buffer: Buffer): Promise<PdfToMarkdownResult> {
  const { text, totalPages } = await extractText(new Uint8Array(buffer));
  let markdown = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
  const firstLine = markdown.split("\n").find((l) => l.trim().length > 0);
  const title = firstLine?.trim() || `PDF Document (${totalPages} pages)`;
  return { content: markdown, title };
}
