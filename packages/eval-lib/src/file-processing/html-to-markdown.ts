import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export interface FileProcessorConfig {
  onlyMainContent?: boolean;
  includeLinks?: boolean;
  baseUrl?: string;
}

export interface ProcessedDocument {
  content: string;
  title: string;
  metadata: {
    sourceFormat: "html" | "pdf" | "markdown";
    wordCount: number;
    links?: string[];
  };
}

export async function htmlToMarkdown(
  html: string,
  config?: FileProcessorConfig,
): Promise<ProcessedDocument> {
  const onlyMainContent = config?.onlyMainContent ?? true;
  const includeLinks = config?.includeLinks ?? true;
  const baseUrl = config?.baseUrl ?? "";

  // Parse HTML with jsdom
  const dom = new JSDOM(html, { url: baseUrl || undefined });
  const document = dom.window.document;

  // Extract title
  const title = document.querySelector("title")?.textContent?.trim() ?? "";

  // Extract all links from the full DOM (before readability strips them)
  const links: string[] = [];
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    try {
      const resolved = baseUrl ? new URL(href, baseUrl).href : href;
      links.push(resolved);
    } catch {
      // Skip malformed URLs
    }
  });

  // Extract main content or use full body
  let contentHtml: string;
  if (onlyMainContent) {
    const reader = new Readability(document);
    const article = reader.parse();
    contentHtml = article?.content ?? document.body?.innerHTML ?? "";
  } else {
    contentHtml = document.body?.innerHTML ?? "";
  }

  // Convert HTML to markdown with turndown
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  if (!includeLinks) {
    turndown.addRule("stripLinks", {
      filter: "a",
      replacement: (_content, node) => {
        return (node as HTMLElement).textContent ?? "";
      },
    });
  }

  let markdown = turndown.turndown(contentHtml);

  // Cleanup: collapse multiple blank lines, trim
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  const wordCount = markdown
    ? markdown.split(/\s+/).filter((w) => w.length > 0).length
    : 0;

  return {
    content: markdown,
    title,
    metadata: {
      sourceFormat: "html",
      wordCount,
      links: [...new Set(links)],
    },
  };
}
