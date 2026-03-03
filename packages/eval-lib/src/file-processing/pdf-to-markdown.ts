/**
 * PDF to Markdown converter using unpdf for text extraction.
 *
 * Extracts text content from PDF buffers and returns a ProcessedDocument
 * with markdown content, title, and metadata.
 */

import type { ProcessedDocument } from "./html-to-markdown.js";

export async function pdfToMarkdown(
  buffer: Buffer,
): Promise<ProcessedDocument> {
  if (buffer.length === 0) {
    return {
      content: "",
      title: "",
      metadata: { sourceFormat: "pdf", wordCount: 0 },
    };
  }

  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));

    // Extract text from all pages
    const pages: string[] = [];
    let title = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .filter((item: any) => "str" in item)
        .map((item: any) => item.str)
        .join(" ");
      pages.push(pageText);
    }

    // Try to get title from metadata
    try {
      const metadata = await pdf.getMetadata();
      title = (metadata?.info as any)?.Title ?? "";
    } catch {
      // Metadata not available
    }

    // Join pages with double newlines, clean up
    let content = pages
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join("\n\n");

    // Basic cleanup: collapse whitespace, trim
    content = content.replace(/\n{3,}/g, "\n\n").trim();

    if (!title && content) {
      // Use first line as title if no metadata title
      const firstLine = content.split("\n")[0]?.trim() ?? "";
      title = firstLine.length <= 200 ? firstLine : firstLine.slice(0, 200);
    }

    const wordCount = content
      ? content.split(/\s+/).filter((w) => w.length > 0).length
      : 0;

    return {
      content,
      title,
      metadata: { sourceFormat: "pdf", wordCount },
    };
  } catch (_error) {
    // If PDF parsing fails entirely, return empty
    return {
      content: "",
      title: "",
      metadata: { sourceFormat: "pdf", wordCount: 0 },
    };
  }
}
