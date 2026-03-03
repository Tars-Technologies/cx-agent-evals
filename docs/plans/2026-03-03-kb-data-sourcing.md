# KB Data Sourcing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an end-to-end KB data sourcing system: file processing pipeline (HTML/PDF → markdown), web scraper, crawl orchestration via Convex WorkPool, and frontend for importing URLs and uploading diverse file types.

**Architecture:** eval-lib owns the stateless scraper SDK and file processing pipeline. The Convex backend handles crawl orchestration (frontier table, WorkPool fan-out, time-budgeted batch actions). Frontend gets minimal additions: industry filter on KBs, URL import button with progress, and PDF/HTML upload support.

**Tech Stack:** TypeScript, Convex (WorkPool, Node actions, mutations), @mozilla/readability + jsdom + turndown (HTML→MD), unpdf (PDF→MD), got-scraping (HTTP), vitest (testing)

**Design Doc:** `packages/eval-lib/docs/kb-data-sourcing-plan.md`

---

## Task 1: Schema Changes — KB Metadata + Crawl Tables

**Files:**
- Modify: `packages/backend/convex/schema.ts`

**Step 1: Add KB metadata fields to `knowledgeBases` table**

In `packages/backend/convex/schema.ts`, find the `knowledgeBases` table definition and add these optional fields after `metadata`:

```typescript
industry: v.optional(v.string()),
subIndustry: v.optional(v.string()),
company: v.optional(v.string()),
entityType: v.optional(v.string()),
sourceUrl: v.optional(v.string()),
tags: v.optional(v.array(v.string())),
```

Add two new indexes to the same table:

```typescript
.index("by_org_industry", ["orgId", "industry"])
.index("by_org_company", ["orgId", "company"])
```

**Step 2: Make `fileId` optional and add source tracking to `documents` table**

Change `fileId: v.id("_storage")` to `fileId: v.optional(v.id("_storage"))`.

Add after `metadata`:

```typescript
sourceUrl: v.optional(v.string()),
sourceType: v.optional(v.string()),
```

**Step 3: Add `crawlJobs` table**

Add after the existing table definitions:

```typescript
crawlJobs: defineTable({
  orgId: v.string(),
  kbId: v.id("knowledgeBases"),
  userId: v.id("users"),
  startUrl: v.string(),
  config: v.object({
    maxDepth: v.optional(v.number()),
    maxPages: v.optional(v.number()),
    includePaths: v.optional(v.array(v.string())),
    excludePaths: v.optional(v.array(v.string())),
    allowSubdomains: v.optional(v.boolean()),
    onlyMainContent: v.optional(v.boolean()),
    delay: v.optional(v.number()),
    concurrency: v.optional(v.number()),
  }),
  status: v.string(),
  stats: v.object({
    discovered: v.number(),
    scraped: v.number(),
    failed: v.number(),
    skipped: v.number(),
  }),
  error: v.optional(v.string()),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_org", ["orgId"])
  .index("by_kb", ["kbId"])
  .index("by_status", ["status"]),
```

**Step 4: Add `crawlUrls` table**

```typescript
crawlUrls: defineTable({
  crawlJobId: v.id("crawlJobs"),
  url: v.string(),
  normalizedUrl: v.string(),
  status: v.string(),
  depth: v.number(),
  parentUrl: v.optional(v.string()),
  documentId: v.optional(v.id("documents")),
  error: v.optional(v.string()),
  retryCount: v.optional(v.number()),
  scrapedAt: v.optional(v.number()),
})
  .index("by_job_status", ["crawlJobId", "status"])
  .index("by_job_url", ["crawlJobId", "normalizedUrl"]),
```

**Step 5: Deploy and verify schema**

Run: `cd packages/backend && npx convex dev --once`
Expected: Schema deploys successfully with no validation errors.

**Step 6: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat: extend schema with KB metadata, crawlJobs, and crawlUrls tables"
```

---

## Task 2: KB CRUD Updates — Create with Metadata + listByIndustry

**Files:**
- Modify: `packages/backend/convex/knowledgeBases.ts`

**Step 1: Update `create` mutation args**

In `packages/backend/convex/knowledgeBases.ts`, add optional args to the `create` mutation:

```typescript
industry: v.optional(v.string()),
subIndustry: v.optional(v.string()),
company: v.optional(v.string()),
entityType: v.optional(v.string()),
sourceUrl: v.optional(v.string()),
tags: v.optional(v.array(v.string())),
```

Pass them through to `ctx.db.insert("knowledgeBases", { ... })`. Use spread or explicit assignment — include them only if defined (Convex stores `undefined` fields as absent).

**Step 2: Add `listByIndustry` query**

Add a new query after the existing `list` query:

```typescript
export const listByIndustry = query({
  args: {
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    if (args.industry) {
      return await ctx.db
        .query("knowledgeBases")
        .withIndex("by_org_industry", (q) =>
          q.eq("orgId", orgId).eq("industry", args.industry),
        )
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});
```

**Step 3: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Deploys successfully.

**Step 4: Commit**

```bash
git add packages/backend/convex/knowledgeBases.ts
git commit -m "feat: add industry metadata to KB create and listByIndustry query"
```

---

## Task 3: Install File Processing Dependencies

**Files:**
- Modify: `packages/eval-lib/package.json`

**Step 1: Install dependencies**

```bash
cd packages/eval-lib
pnpm add @mozilla/readability jsdom turndown unpdf
pnpm add -D @types/jsdom @types/turndown
```

**Step 2: Verify build still works**

Run: `pnpm build`
Expected: Build succeeds (new deps don't break anything).

**Step 3: Commit**

```bash
git add packages/eval-lib/package.json pnpm-lock.yaml
git commit -m "chore: add file processing dependencies (readability, jsdom, turndown, unpdf)"
```

---

## Task 4: HTML to Markdown Converter

**Files:**
- Create: `packages/eval-lib/src/file-processing/html-to-markdown.ts`
- Create: `packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts`

**Step 1: Write failing tests**

Create `packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../../../src/file-processing/html-to-markdown.js";

describe("htmlToMarkdown", () => {
  it("should convert simple HTML to markdown", async () => {
    const html = `
      <html><head><title>Test Page</title></head>
      <body>
        <article>
          <h1>Hello World</h1>
          <p>This is a <strong>test</strong> paragraph.</p>
          <p>Second paragraph with a <a href="https://example.com">link</a>.</p>
        </article>
      </body></html>
    `;
    const result = await htmlToMarkdown(html);

    expect(result.title).toBe("Test Page");
    expect(result.content).toContain("Hello World");
    expect(result.content).toContain("**test**");
    expect(result.content).toContain("[link](https://example.com)");
    expect(result.metadata.sourceFormat).toBe("html");
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });

  it("should extract links from HTML", async () => {
    const html = `
      <html><head><title>Links Page</title></head>
      <body>
        <article>
          <p>Content here.</p>
          <a href="https://example.com/page1">Page 1</a>
          <a href="https://example.com/page2">Page 2</a>
          <a href="/relative">Relative</a>
        </article>
      </body></html>
    `;
    const result = await htmlToMarkdown(html, {
      baseUrl: "https://example.com",
    });

    expect(result.metadata.links).toBeDefined();
    expect(result.metadata.links).toContain("https://example.com/page1");
    expect(result.metadata.links).toContain("https://example.com/page2");
    expect(result.metadata.links).toContain("https://example.com/relative");
  });

  it("should extract main content when onlyMainContent is true", async () => {
    const html = `
      <html><head><title>Article</title></head>
      <body>
        <nav><a href="/home">Home</a><a href="/about">About</a></nav>
        <article>
          <h1>Main Article Title</h1>
          <p>This is the main article content that is long enough for readability to detect it as the primary content of the page. It needs to be sufficiently long so the algorithm identifies it properly. Here is more text to make it substantial enough for the content extraction algorithm.</p>
          <p>Another paragraph with substantial content to ensure readability picks this up as the main article. The content needs several paragraphs to be detected properly by the Mozilla Readability algorithm.</p>
        </article>
        <footer>Copyright 2024</footer>
      </body></html>
    `;
    const result = await htmlToMarkdown(html, { onlyMainContent: true });

    expect(result.content).toContain("Main Article Title");
    expect(result.content).toContain("main article content");
    // Nav and footer should be stripped by readability
    expect(result.content).not.toContain("Copyright 2024");
  });

  it("should strip links when includeLinks is false", async () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <article>
          <p>Visit <a href="https://example.com">our site</a> for more.</p>
        </article>
      </body></html>
    `;
    const result = await htmlToMarkdown(html, { includeLinks: false });

    expect(result.content).toContain("our site");
    expect(result.content).not.toContain("https://example.com");
  });

  it("should handle empty or minimal HTML", async () => {
    const html = `<html><head><title></title></head><body></body></html>`;
    const result = await htmlToMarkdown(html);

    expect(result.content).toBe("");
    expect(result.title).toBe("");
    expect(result.metadata.wordCount).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/eval-lib test -- tests/unit/file-processing/html-to-markdown.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `html-to-markdown.ts`**

Create `packages/eval-lib/src/file-processing/html-to-markdown.ts`:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- tests/unit/file-processing/html-to-markdown.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/eval-lib/src/file-processing/html-to-markdown.ts packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts
git commit -m "feat: add HTML to markdown converter with readability + turndown"
```

---

## Task 5: PDF to Markdown Converter

**Files:**
- Create: `packages/eval-lib/src/file-processing/pdf-to-markdown.ts`
- Create: `packages/eval-lib/tests/unit/file-processing/pdf-to-markdown.test.ts`

**Step 1: Write failing tests**

Create `packages/eval-lib/tests/unit/file-processing/pdf-to-markdown.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pdfToMarkdown } from "../../../src/file-processing/pdf-to-markdown.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("pdfToMarkdown", () => {
  it("should extract text from a PDF buffer", async () => {
    // Create a minimal test PDF or use a fixture
    // For now, test with a simple buffer that unpdf can handle
    const fixturePath = join(__dirname, "../../fixtures/sample.pdf");
    let buffer: Buffer;
    try {
      buffer = await readFile(fixturePath);
    } catch {
      // If no fixture, skip this test gracefully
      console.warn("No sample.pdf fixture found, skipping PDF extraction test");
      return;
    }

    const result = await pdfToMarkdown(buffer);

    expect(result.content).toBeTruthy();
    expect(result.metadata.sourceFormat).toBe("pdf");
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });

  it("should return empty content for empty buffer", async () => {
    // Empty or invalid PDF should return empty content, not throw
    const emptyBuffer = Buffer.alloc(0);

    const result = await pdfToMarkdown(emptyBuffer);

    expect(result.content).toBe("");
    expect(result.metadata.wordCount).toBe(0);
  });

  it("should set title from PDF metadata when available", async () => {
    const fixturePath = join(__dirname, "../../fixtures/sample.pdf");
    let buffer: Buffer;
    try {
      buffer = await readFile(fixturePath);
    } catch {
      return; // Skip if no fixture
    }

    const result = await pdfToMarkdown(buffer);

    expect(result.title).toBeDefined();
    expect(typeof result.title).toBe("string");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/eval-lib test -- tests/unit/file-processing/pdf-to-markdown.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `pdf-to-markdown.ts`**

Create `packages/eval-lib/src/file-processing/pdf-to-markdown.ts`:

```typescript
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
  } catch (error) {
    // If PDF parsing fails entirely, return empty
    return {
      content: "",
      title: "",
      metadata: { sourceFormat: "pdf", wordCount: 0 },
    };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- tests/unit/file-processing/pdf-to-markdown.test.ts`
Expected: Tests PASS (empty buffer test passes; fixture tests skip gracefully if no sample.pdf).

**Step 5: Commit**

```bash
git add packages/eval-lib/src/file-processing/pdf-to-markdown.ts packages/eval-lib/tests/unit/file-processing/pdf-to-markdown.test.ts
git commit -m "feat: add PDF to markdown converter using unpdf"
```

---

## Task 6: File Processor Dispatcher + Barrel Export

**Files:**
- Create: `packages/eval-lib/src/file-processing/processor.ts`
- Create: `packages/eval-lib/src/file-processing/index.ts`
- Modify: `packages/eval-lib/src/index.ts`
- Create: `packages/eval-lib/tests/unit/file-processing/processor.test.ts`

**Step 1: Write failing tests**

Create `packages/eval-lib/tests/unit/file-processing/processor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { processFile } from "../../../src/file-processing/processor.js";

describe("processFile", () => {
  it("should dispatch HTML input to htmlToMarkdown", async () => {
    const result = await processFile({
      content: "<html><head><title>Test</title></head><body><article><h1>Hello</h1><p>World</p></article></body></html>",
      format: "html",
    });

    expect(result.content).toContain("Hello");
    expect(result.metadata.sourceFormat).toBe("html");
  });

  it("should handle raw markdown input with cleanup", async () => {
    const result = await processFile({
      content: "# Title\n\n\n\n\nParagraph with   extra   spaces.\n\n\n\nEnd.",
      format: "markdown",
    });

    expect(result.content).toBe("# Title\n\nParagraph with   extra   spaces.\n\nEnd.");
    expect(result.metadata.sourceFormat).toBe("markdown");
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });

  it("should extract title from markdown first heading", async () => {
    const result = await processFile({
      content: "# My Document\n\nSome content here.",
      format: "markdown",
    });

    expect(result.title).toBe("My Document");
  });

  it("should dispatch PDF buffer to pdfToMarkdown", async () => {
    // Empty buffer should not throw
    const result = await processFile({
      buffer: Buffer.alloc(0),
      format: "pdf",
    });

    expect(result.content).toBe("");
    expect(result.metadata.sourceFormat).toBe("pdf");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/eval-lib test -- tests/unit/file-processing/processor.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `processor.ts`**

Create `packages/eval-lib/src/file-processing/processor.ts`:

```typescript
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
      // Cleanup: collapse multiple blank lines, trim
      const content = input.content.replace(/\n{3,}/g, "\n\n").trim();

      // Extract title from first heading
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
```

**Step 4: Create barrel export**

Create `packages/eval-lib/src/file-processing/index.ts`:

```typescript
export { processFile } from "./processor.js";
export type { FileProcessorConfig, ProcessedDocument } from "./processor.js";
export { htmlToMarkdown } from "./html-to-markdown.js";
export { pdfToMarkdown } from "./pdf-to-markdown.js";
```

**Step 5: Add to eval-lib main export**

In `packages/eval-lib/src/index.ts`, add at the end:

```typescript
// ─── File Processing ───
export {
  processFile,
  htmlToMarkdown,
  pdfToMarkdown,
} from "./file-processing/index.js";
export type {
  FileProcessorConfig,
  ProcessedDocument,
} from "./file-processing/index.js";
```

**Step 6: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- tests/unit/file-processing/`
Expected: All file processing tests PASS.

**Step 7: Verify build**

Run: `pnpm build`
Expected: Build succeeds with new exports.

**Step 8: Commit**

```bash
git add packages/eval-lib/src/file-processing/ packages/eval-lib/tests/unit/file-processing/ packages/eval-lib/src/index.ts
git commit -m "feat: add file processor dispatcher with markdown cleanup and barrel exports"
```

---

## Task 7: Install Scraper Dependencies

**Files:**
- Modify: `packages/eval-lib/package.json`

**Step 1: Install dependencies**

```bash
cd packages/eval-lib
pnpm add got-scraping
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/eval-lib/package.json pnpm-lock.yaml
git commit -m "chore: add got-scraping dependency for web scraper"
```

---

## Task 8: Scraper Types + Link Extractor + URL Utils

**Files:**
- Create: `packages/eval-lib/src/scraper/types.ts`
- Create: `packages/eval-lib/src/scraper/link-extractor.ts`
- Create: `packages/eval-lib/tests/unit/scraper/link-extractor.test.ts`

**Step 1: Create scraper types**

Create `packages/eval-lib/src/scraper/types.ts`:

```typescript
export interface ScrapedPage {
  url: string;
  markdown: string;
  metadata: {
    title: string;
    sourceURL: string;
    description?: string;
    language?: string;
    statusCode: number;
    links: string[];
  };
}

export interface ScrapeOptions {
  onlyMainContent?: boolean;
  includeLinks?: boolean;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface SeedEntity {
  name: string;
  industry: string;
  subIndustry: string;
  entityType:
    | "company"
    | "government-state"
    | "government-county"
    | "industry-aggregate";
  sourceUrls: string[];
  tags: string[];
  notes?: string;
}
```

**Step 2: Write failing tests for link extractor**

Create `packages/eval-lib/tests/unit/scraper/link-extractor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  filterLinks,
  normalizeUrl,
} from "../../../src/scraper/link-extractor.js";

describe("normalizeUrl", () => {
  it("should strip trailing slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
  });

  it("should strip fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
  });

  it("should lowercase host", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/Page")).toBe(
      "https://example.com/Page",
    );
  });

  it("should sort query params", () => {
    expect(normalizeUrl("https://example.com?b=2&a=1")).toBe(
      "https://example.com?a=1&b=2",
    );
  });

  it("should handle URLs without path", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });
});

describe("filterLinks", () => {
  const links = [
    "https://example.com/help/faq",
    "https://example.com/help/contact",
    "https://example.com/login",
    "https://example.com/admin/settings",
    "https://example.com/about",
    "https://other.com/page",
    "https://blog.example.com/post",
  ];

  it("should return all same-domain links when no filters", () => {
    const result = filterLinks(links, "https://example.com");
    expect(result).toContain("https://example.com/help/faq");
    expect(result).toContain("https://example.com/about");
    expect(result).not.toContain("https://other.com/page");
    expect(result).not.toContain("https://blog.example.com/post");
  });

  it("should filter by includePaths", () => {
    const result = filterLinks(links, "https://example.com", {
      includePaths: ["/help/*"],
    });
    expect(result).toEqual([
      "https://example.com/help/faq",
      "https://example.com/help/contact",
    ]);
  });

  it("should filter by excludePaths", () => {
    const result = filterLinks(links, "https://example.com", {
      excludePaths: ["/login", "/admin/*"],
    });
    expect(result).not.toContain("https://example.com/login");
    expect(result).not.toContain("https://example.com/admin/settings");
    expect(result).toContain("https://example.com/help/faq");
  });

  it("should allow subdomains when configured", () => {
    const result = filterLinks(links, "https://example.com", {
      allowSubdomains: true,
    });
    expect(result).toContain("https://blog.example.com/post");
  });

  it("should handle empty input", () => {
    expect(filterLinks([], "https://example.com")).toEqual([]);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm -C packages/eval-lib test -- tests/unit/scraper/link-extractor.test.ts`
Expected: FAIL — module not found.

**Step 4: Implement `link-extractor.ts`**

Create `packages/eval-lib/src/scraper/link-extractor.ts`:

```typescript
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Lowercase host
    parsed.hostname = parsed.hostname.toLowerCase();
    // Strip fragment
    parsed.hash = "";
    // Sort query params
    const params = new URLSearchParams(parsed.search);
    const sorted = new URLSearchParams([...params.entries()].sort());
    parsed.search = sorted.toString();

    let result = parsed.href;
    // Strip trailing slash (but not for root)
    if (result.endsWith("/") && parsed.pathname !== "/") {
      result = result.slice(0, -1);
    }
    // Also strip trailing slash on root if no query/hash
    if (result.endsWith("/") && !parsed.search) {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return url;
  }
}

function matchesGlob(path: string, pattern: string): boolean {
  // Simple glob: * matches any segment, ** matches multiple segments
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");
  return new RegExp(`^${regexStr}$`).test(path);
}

export function filterLinks(
  links: string[],
  baseUrl: string,
  config?: {
    includePaths?: string[];
    excludePaths?: string[];
    allowSubdomains?: boolean;
  },
): string[] {
  const base = new URL(baseUrl);
  const baseDomain = base.hostname;

  return links.filter((link) => {
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      return false;
    }

    // Domain check
    const isSameDomain = parsed.hostname === baseDomain;
    const isSubdomain =
      parsed.hostname.endsWith(`.${baseDomain}`) &&
      parsed.hostname !== baseDomain;

    if (!isSameDomain && !(config?.allowSubdomains && isSubdomain)) {
      return false;
    }

    const path = parsed.pathname;

    // Include filter (if specified, only matching paths pass)
    if (config?.includePaths?.length) {
      const included = config.includePaths.some((p) => matchesGlob(path, p));
      if (!included) return false;
    }

    // Exclude filter
    if (config?.excludePaths?.length) {
      const excluded = config.excludePaths.some((p) => matchesGlob(path, p));
      if (excluded) return false;
    }

    return true;
  });
}
```

**Step 5: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- tests/unit/scraper/link-extractor.test.ts`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add packages/eval-lib/src/scraper/types.ts packages/eval-lib/src/scraper/link-extractor.ts packages/eval-lib/tests/unit/scraper/link-extractor.test.ts
git commit -m "feat: add scraper types, link extractor with glob filtering, and URL normalization"
```

---

## Task 9: ContentScraper Class

**Files:**
- Create: `packages/eval-lib/src/scraper/scraper.ts`
- Create: `packages/eval-lib/tests/unit/scraper/scraper.test.ts`

**Step 1: Write failing tests**

Create `packages/eval-lib/tests/unit/scraper/scraper.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ContentScraper } from "../../../src/scraper/scraper.js";

// Mock got-scraping to avoid real HTTP calls
vi.mock("got-scraping", () => ({
  gotScraping: vi.fn(),
}));

describe("ContentScraper", () => {
  it("should scrape a URL and return markdown + metadata", async () => {
    const { gotScraping } = await import("got-scraping");
    const mockGot = vi.mocked(gotScraping);

    mockGot.mockResolvedValueOnce({
      body: `<html><head><title>Test Page</title></head>
        <body><article><h1>Hello</h1><p>World content here with enough text.</p>
        <a href="https://example.com/other">Link</a></article></body></html>`,
      statusCode: 200,
    } as any);

    const scraper = new ContentScraper();
    const result = await scraper.scrape("https://example.com/page");

    expect(result.url).toBe("https://example.com/page");
    expect(result.markdown).toContain("Hello");
    expect(result.markdown).toContain("World");
    expect(result.metadata.title).toBe("Test Page");
    expect(result.metadata.sourceURL).toBe("https://example.com/page");
    expect(result.metadata.statusCode).toBe(200);
    expect(result.metadata.links).toContain("https://example.com/other");
  });

  it("should pass custom headers to got-scraping", async () => {
    const { gotScraping } = await import("got-scraping");
    const mockGot = vi.mocked(gotScraping);

    mockGot.mockResolvedValueOnce({
      body: "<html><head><title>T</title></head><body><p>Ok</p></body></html>",
      statusCode: 200,
    } as any);

    const scraper = new ContentScraper({
      defaultHeaders: { "X-Custom": "test" },
    });
    await scraper.scrape("https://example.com", {
      headers: { Authorization: "Bearer xyz" },
    });

    expect(mockGot).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Custom": "test",
          Authorization: "Bearer xyz",
        }),
      }),
    );
  });

  it("should throw on HTTP errors", async () => {
    const { gotScraping } = await import("got-scraping");
    const mockGot = vi.mocked(gotScraping);

    mockGot.mockRejectedValueOnce(new Error("Request failed: 404"));

    const scraper = new ContentScraper();
    await expect(scraper.scrape("https://example.com/missing")).rejects.toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/eval-lib test -- tests/unit/scraper/scraper.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `scraper.ts`**

Create `packages/eval-lib/src/scraper/scraper.ts`:

```typescript
import { gotScraping } from "got-scraping";
import { htmlToMarkdown } from "../file-processing/html-to-markdown.js";
import type { ScrapedPage, ScrapeOptions } from "./types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; KBDataSourcing/1.0; +https://github.com/vinit-agr/cx-agent-evals)";
const DEFAULT_TIMEOUT = 30_000;

export class ContentScraper {
  private userAgent: string;
  private defaultHeaders: Record<string, string>;

  constructor(config?: {
    userAgent?: string;
    defaultHeaders?: Record<string, string>;
  }) {
    this.userAgent = config?.userAgent ?? DEFAULT_USER_AGENT;
    this.defaultHeaders = config?.defaultHeaders ?? {};
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapedPage> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

    const response = await gotScraping({
      url,
      timeout: { request: timeout },
      headers: {
        "User-Agent": this.userAgent,
        ...this.defaultHeaders,
        ...options?.headers,
      },
    });

    const html = response.body as string;
    const statusCode = response.statusCode ?? 200;

    const processed = await htmlToMarkdown(html, {
      onlyMainContent: options?.onlyMainContent ?? true,
      includeLinks: options?.includeLinks ?? true,
      baseUrl: url,
    });

    return {
      url,
      markdown: processed.content,
      metadata: {
        title: processed.title,
        sourceURL: url,
        statusCode,
        links: processed.metadata.links ?? [],
      },
    };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- tests/unit/scraper/scraper.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/eval-lib/src/scraper/scraper.ts packages/eval-lib/tests/unit/scraper/scraper.test.ts
git commit -m "feat: add ContentScraper class with got-scraping HTTP client"
```

---

## Task 10: Seed Companies + Scraper Barrel Export

**Files:**
- Create: `packages/eval-lib/src/scraper/seed-companies.ts`
- Create: `packages/eval-lib/src/scraper/index.ts`
- Modify: `packages/eval-lib/src/index.ts`
- Create: `packages/eval-lib/tests/unit/scraper/seed-companies.test.ts`

**Step 1: Write failing tests for seed companies**

Create `packages/eval-lib/tests/unit/scraper/seed-companies.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  SEED_ENTITIES,
  getSeedIndustries,
  getSeedEntitiesByIndustry,
} from "../../../src/scraper/seed-companies.js";

describe("seed companies", () => {
  it("should have 28 entities total", () => {
    expect(SEED_ENTITIES).toHaveLength(28);
  });

  it("should return 6 industries", () => {
    const industries = getSeedIndustries();
    expect(industries).toHaveLength(6);
    expect(industries).toContain("finance");
    expect(industries).toContain("insurance");
    expect(industries).toContain("healthcare");
    expect(industries).toContain("telecom");
    expect(industries).toContain("education");
    expect(industries).toContain("government");
  });

  it("should return 3 finance entities", () => {
    const finance = getSeedEntitiesByIndustry("finance");
    expect(finance).toHaveLength(3);
    expect(finance.map((e) => e.name)).toContain("JPMorgan Chase");
  });

  it("should return 13 government entities (8 states + 5 counties)", () => {
    const gov = getSeedEntitiesByIndustry("government");
    expect(gov).toHaveLength(13);
  });

  it("should return empty array for unknown industry", () => {
    expect(getSeedEntitiesByIndustry("unknown")).toEqual([]);
  });

  it("every entity should have required fields", () => {
    for (const entity of SEED_ENTITIES) {
      expect(entity.name).toBeTruthy();
      expect(entity.industry).toBeTruthy();
      expect(entity.subIndustry).toBeTruthy();
      expect(entity.entityType).toBeTruthy();
      expect(entity.sourceUrls.length).toBeGreaterThan(0);
      expect(entity.tags.length).toBeGreaterThan(0);
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/eval-lib test -- tests/unit/scraper/seed-companies.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `seed-companies.ts`**

Create `packages/eval-lib/src/scraper/seed-companies.ts`:

```typescript
import type { SeedEntity } from "./types.js";

export const SEED_ENTITIES: SeedEntity[] = [
  // ─── Finance (3) ───
  {
    name: "JPMorgan Chase",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: ["https://www.chase.com/digital/resources/privacy-security/questions"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Bank of America",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: ["https://www.bankofamerica.com/customer-service/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Wells Fargo",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: ["https://www.wellsfargo.com/help/"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Insurance (3) ───
  {
    name: "UnitedHealth Group",
    industry: "insurance",
    subIndustry: "health-insurance",
    entityType: "company",
    sourceUrls: ["https://www.uhc.com/member-resources"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Elevance Health",
    industry: "insurance",
    subIndustry: "health-insurance",
    entityType: "company",
    sourceUrls: ["https://www.anthem.com/member/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "MetLife",
    industry: "insurance",
    subIndustry: "life-insurance",
    entityType: "company",
    sourceUrls: ["https://www.metlife.com/support/"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Healthcare (3) ───
  {
    name: "CVS Health",
    industry: "healthcare",
    subIndustry: "pharmacy",
    entityType: "company",
    sourceUrls: ["https://www.cvs.com/help/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "HCA Healthcare",
    industry: "healthcare",
    subIndustry: "hospital-systems",
    entityType: "company",
    sourceUrls: ["https://www.hcahealthcare.com/patients/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Humana",
    industry: "healthcare",
    subIndustry: "health-insurance",
    entityType: "company",
    sourceUrls: ["https://www.humana.com/help/"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Telecom (3) ───
  {
    name: "AT&T",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: ["https://www.att.com/support/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Verizon",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: ["https://www.verizon.com/support/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "T-Mobile",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: ["https://www.t-mobile.com/support/"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Education (3) ───
  {
    name: "University of California System",
    industry: "education",
    subIndustry: "higher-education",
    entityType: "company",
    sourceUrls: ["https://www.universityofcalifornia.edu/"],
    tags: ["public-university", "cx"],
  },
  {
    name: "Coursera",
    industry: "education",
    subIndustry: "online-learning",
    entityType: "company",
    sourceUrls: ["https://www.coursera.org/about/"],
    tags: ["edtech", "cx"],
  },
  {
    name: "Pearson",
    industry: "education",
    subIndustry: "publishing",
    entityType: "company",
    sourceUrls: ["https://www.pearson.com/en-us/support.html"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Government - States (8) ───
  {
    name: "California",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.ca.gov/"],
    tags: ["government", "state", "west"],
  },
  {
    name: "Texas",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.texas.gov/"],
    tags: ["government", "state", "south"],
  },
  {
    name: "New York",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.ny.gov/"],
    tags: ["government", "state", "northeast"],
  },
  {
    name: "Florida",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.myflorida.com/"],
    tags: ["government", "state", "south"],
  },
  {
    name: "Illinois",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.illinois.gov/"],
    tags: ["government", "state", "midwest"],
  },
  {
    name: "Ohio",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://ohio.gov/"],
    tags: ["government", "state", "midwest"],
  },
  {
    name: "Georgia",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://georgia.gov/"],
    tags: ["government", "state", "south"],
  },
  {
    name: "Washington",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://wa.gov/"],
    tags: ["government", "state", "west"],
  },

  // ─── Government - Counties (5) ───
  {
    name: "Los Angeles County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://lacounty.gov/"],
    tags: ["government", "county", "west"],
  },
  {
    name: "Cook County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://www.cookcountyil.gov/"],
    tags: ["government", "county", "midwest"],
  },
  {
    name: "Harris County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://www.harriscountytx.gov/"],
    tags: ["government", "county", "south"],
  },
  {
    name: "Maricopa County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://www.maricopa.gov/"],
    tags: ["government", "county", "west"],
  },
  {
    name: "King County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://kingcounty.gov/"],
    tags: ["government", "county", "west"],
  },
];

export function getSeedIndustries(): string[] {
  return [...new Set(SEED_ENTITIES.map((e) => e.industry))];
}

export function getSeedEntitiesByIndustry(industry: string): SeedEntity[] {
  return SEED_ENTITIES.filter((e) => e.industry === industry);
}
```

**Step 4: Create scraper barrel export**

Create `packages/eval-lib/src/scraper/index.ts`:

```typescript
export { ContentScraper } from "./scraper.js";
export type { ScrapedPage, ScrapeOptions, SeedEntity } from "./types.js";
export { filterLinks, normalizeUrl } from "./link-extractor.js";
export {
  SEED_ENTITIES,
  getSeedIndustries,
  getSeedEntitiesByIndustry,
} from "./seed-companies.js";
```

**Step 5: Add to eval-lib main export**

In `packages/eval-lib/src/index.ts`, add at the end:

```typescript
// ─── Scraper ───
export {
  ContentScraper,
  filterLinks,
  normalizeUrl,
  SEED_ENTITIES,
  getSeedIndustries,
  getSeedEntitiesByIndustry,
} from "./scraper/index.js";
export type {
  ScrapedPage,
  ScrapeOptions,
  SeedEntity,
} from "./scraper/index.js";
```

**Step 6: Run all scraper tests**

Run: `pnpm -C packages/eval-lib test -- tests/unit/scraper/`
Expected: All scraper tests PASS.

**Step 7: Verify build**

Run: `pnpm build`
Expected: Build succeeds with all new exports.

**Step 8: Commit**

```bash
git add packages/eval-lib/src/scraper/ packages/eval-lib/tests/unit/scraper/ packages/eval-lib/src/index.ts
git commit -m "feat: add seed companies, scraper barrel export, and eval-lib integration"
```

---

## Task 11: Scraping WorkPool + Crawl Mutations

**Files:**
- Modify: `packages/backend/convex/convex.config.ts`
- Create: `packages/backend/convex/scrapingMutations.ts`
- Create: `packages/backend/convex/scraping.ts`

**Step 1: Add scrapingPool to convex.config.ts**

In `packages/backend/convex/convex.config.ts`, add:

```typescript
app.use(workpool, { name: "scrapingPool" });
```

**Step 2: Create internal mutations and queries**

Create `packages/backend/convex/scrapingMutations.ts`:

```typescript
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ─── Queries ───

export const getPendingUrls = internalQuery({
  args: {
    crawlJobId: v.id("crawlJobs"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_status", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("status", "pending"),
      )
      .take(args.limit);
  },
});

export const getCrawlJob = internalQuery({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const countPendingUrls = internalQuery({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_status", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("status", "pending"),
      )
      .collect();
    return pending.length;
  },
});

// ─── Mutations ───

export const markUrlsScraping = internalMutation({
  args: {
    urlIds: v.array(v.id("crawlUrls")),
  },
  handler: async (ctx, args) => {
    for (const id of args.urlIds) {
      await ctx.db.patch(id, { status: "scraping" });
    }
  },
});

export const persistScrapedPage = internalMutation({
  args: {
    crawlUrlId: v.id("crawlUrls"),
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    title: v.string(),
    content: v.string(),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const docId = await ctx.db.insert("documents", {
      orgId: args.orgId,
      kbId: args.kbId,
      docId: args.title,
      title: args.title,
      content: args.content,
      contentLength: args.content.length,
      metadata: {},
      sourceUrl: args.sourceUrl,
      sourceType: "scraped",
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.crawlUrlId, {
      status: "done",
      documentId: docId,
      scrapedAt: Date.now(),
    });

    return docId;
  },
});

export const insertDiscoveredUrls = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    urls: v.array(
      v.object({
        url: v.string(),
        normalizedUrl: v.string(),
        depth: v.number(),
        parentUrl: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    for (const urlData of args.urls) {
      // Dedup check via index
      const existing = await ctx.db
        .query("crawlUrls")
        .withIndex("by_job_url", (q) =>
          q
            .eq("crawlJobId", args.crawlJobId)
            .eq("normalizedUrl", urlData.normalizedUrl),
        )
        .first();

      if (!existing) {
        await ctx.db.insert("crawlUrls", {
          crawlJobId: args.crawlJobId,
          url: urlData.url,
          normalizedUrl: urlData.normalizedUrl,
          status: "pending",
          depth: urlData.depth,
          parentUrl: urlData.parentUrl,
          retryCount: 0,
        });
        inserted++;
      }
    }
    return { inserted };
  },
});

export const markUrlFailed = internalMutation({
  args: {
    crawlUrlId: v.id("crawlUrls"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const url = await ctx.db.get(args.crawlUrlId);
    if (!url) return;

    await ctx.db.patch(args.crawlUrlId, {
      status: "failed",
      error: args.error,
      retryCount: (url.retryCount ?? 0) + 1,
    });
  },
});

export const updateCrawlJobStats = internalMutation({
  args: {
    jobId: v.id("crawlJobs"),
    scrapedDelta: v.number(),
    failedDelta: v.number(),
    discoveredDelta: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

    await ctx.db.patch(args.jobId, {
      stats: {
        discovered: job.stats.discovered + args.discoveredDelta,
        scraped: job.stats.scraped + args.scrapedDelta,
        failed: job.stats.failed + args.failedDelta,
        skipped: job.stats.skipped,
      },
    });
  },
});

export const completeCrawlJob = internalMutation({
  args: {
    jobId: v.id("crawlJobs"),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: args.status,
      error: args.error,
      completedAt: Date.now(),
    });
  },
});

export const resetFailedUrlsForRetry = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    maxRetries: v.number(),
  },
  handler: async (ctx, args) => {
    const failedUrls = await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_status", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("status", "failed"),
      )
      .collect();

    let reset = 0;
    for (const url of failedUrls) {
      if ((url.retryCount ?? 0) < args.maxRetries) {
        await ctx.db.patch(url._id, { status: "pending" });
        reset++;
      }
    }
    return { reset };
  },
});
```

**Step 3: Create scraping orchestration (WorkPool + mutations)**

Create `packages/backend/convex/scraping.ts`:

```typescript
import { mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import {
  Workpool,
  vOnCompleteArgs,
  type RunResult,
} from "@convex-dev/workpool";
import { getAuthContext } from "./lib/auth";
import { internalMutation } from "./_generated/server";
import { normalizeUrl } from "rag-evaluation-system";

// ─── WorkPool Instance ───

const pool = new Workpool(components.scrapingPool, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 5000,
    base: 2,
  },
});

// ─── Start Crawl ───

export const startCrawl = mutation({
  args: {
    kbId: v.id("knowledgeBases"),
    startUrl: v.string(),
    config: v.optional(
      v.object({
        maxDepth: v.optional(v.number()),
        maxPages: v.optional(v.number()),
        includePaths: v.optional(v.array(v.string())),
        excludePaths: v.optional(v.array(v.string())),
        allowSubdomains: v.optional(v.boolean()),
        onlyMainContent: v.optional(v.boolean()),
        delay: v.optional(v.number()),
        concurrency: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Verify KB ownership
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    // Look up user record
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    const config = args.config ?? {};

    // Create crawl job
    const jobId = await ctx.db.insert("crawlJobs", {
      orgId,
      kbId: args.kbId,
      userId: user._id,
      startUrl: args.startUrl,
      config,
      status: "running",
      stats: { discovered: 1, scraped: 0, failed: 0, skipped: 0 },
      createdAt: Date.now(),
    });

    // Insert seed URL
    await ctx.db.insert("crawlUrls", {
      crawlJobId: jobId,
      url: args.startUrl,
      normalizedUrl: normalizeUrl(args.startUrl),
      status: "pending",
      depth: 0,
      retryCount: 0,
    });

    // Enqueue first batch scrape action
    await pool.enqueueAction(
      ctx,
      internal.scrapingActions.batchScrape,
      { crawlJobId: jobId },
      {
        context: { jobId },
        onComplete: internal.scraping.onBatchComplete,
      },
    );

    return { jobId };
  },
});

// ─── Cancel Crawl ───

export const cancelCrawl = mutation({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) throw new Error("Job not found");
    if (job.status !== "running") throw new Error("Job is not running");

    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      completedAt: Date.now(),
    });
  },
});

// ─── Crawl Queries ───

export const getCrawlJob = query({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) return null;
    return job;
  },
});

export const listCrawlJobs = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db
      .query("crawlJobs")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .order("desc")
      .collect();
  },
});

// ─── onComplete Callback ───

export const onBatchComplete = internalMutation({
  args: vOnCompleteArgs,
  handler: async (ctx, args) => {
    const jobId = args.context.jobId as string;
    const job = await ctx.db.get(jobId as any);
    if (!job) return;

    // If cancelled or already completed, don't continue
    if (job.status === "cancelled" || job.status === "completed") return;

    const result = args.result as RunResult;

    // If the action itself failed (WorkPool-level), check retries
    if (result.kind !== "success") {
      // WorkPool handles retries; if all retries exhausted, mark job failed
      if (result.kind === "failed") {
        await ctx.db.patch(job._id, {
          status: "failed",
          error: `Batch scrape action failed after retries`,
          completedAt: Date.now(),
        });
      }
      return;
    }

    // Reset failed URLs that haven't exceeded max retries
    await ctx.runMutation(
      internal.scrapingMutations.resetFailedUrlsForRetry,
      { crawlJobId: job._id, maxRetries: 3 },
    );

    // Check if there's more work to do
    const pendingCount = await ctx.runQuery(
      internal.scrapingMutations.countPendingUrls,
      { crawlJobId: job._id },
    );

    const maxPages = job.config.maxPages ?? 100;
    const reachedLimit = job.stats.scraped >= maxPages;

    if (pendingCount > 0 && !reachedLimit) {
      // Enqueue another batch
      await pool.enqueueAction(
        ctx,
        internal.scrapingActions.batchScrape,
        { crawlJobId: job._id },
        {
          context: { jobId: job._id },
          onComplete: internal.scraping.onBatchComplete,
        },
      );
    } else {
      // Job complete
      const finalStatus =
        job.stats.failed > 0 ? "completed" : "completed";
      await ctx.db.patch(job._id, {
        status: finalStatus,
        completedAt: Date.now(),
      });
    }
  },
});
```

**Step 4: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Deploys successfully.

**Step 5: Commit**

```bash
git add packages/backend/convex/convex.config.ts packages/backend/convex/scraping.ts packages/backend/convex/scrapingMutations.ts
git commit -m "feat: add scraping WorkPool, crawl mutations, and orchestration layer"
```

---

## Task 12: batchScrape Action (Time-Budgeted)

**Files:**
- Create: `packages/backend/convex/scrapingActions.ts`

**Step 1: Rebuild eval-lib**

The backend needs the latest eval-lib with the scraper module:

Run: `pnpm build`
Expected: Build succeeds.

**Step 2: Implement `scrapingActions.ts`**

Create `packages/backend/convex/scrapingActions.ts`:

```typescript
"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ContentScraper, filterLinks, normalizeUrl } from "rag-evaluation-system";

const TIME_BUDGET_MS = 9 * 60 * 1000; // 9 minutes
const BATCH_SIZE = 15;
const MIN_TIME_REMAINING_MS = 30_000; // 30 seconds buffer

export const batchScrape = internalAction({
  args: {
    crawlJobId: v.id("crawlJobs"),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const scraper = new ContentScraper();

    // Load job config
    const job = await ctx.runQuery(
      internal.scrapingMutations.getCrawlJob,
      { jobId: args.crawlJobId },
    );
    if (!job) throw new Error("Crawl job not found");
    if (job.status === "cancelled") return;

    const maxPages = job.config.maxPages ?? 100;
    const maxDepth = job.config.maxDepth ?? 3;
    const delay = job.config.delay ?? 0;
    const concurrency = job.config.concurrency ?? 3;
    const onlyMainContent = job.config.onlyMainContent ?? true;

    let totalScraped = 0;
    let totalFailed = 0;
    let totalDiscovered = 0;

    // Time-budgeted loop
    while (Date.now() - startTime < TIME_BUDGET_MS - MIN_TIME_REMAINING_MS) {
      // Check if job was cancelled
      const currentJob = await ctx.runQuery(
        internal.scrapingMutations.getCrawlJob,
        { jobId: args.crawlJobId },
      );
      if (!currentJob || currentJob.status === "cancelled") break;

      // Check max pages
      if (currentJob.stats.scraped + totalScraped >= maxPages) break;

      // Get next batch of pending URLs
      const batch = await ctx.runQuery(
        internal.scrapingMutations.getPendingUrls,
        { crawlJobId: args.crawlJobId, limit: BATCH_SIZE },
      );
      if (batch.length === 0) break;

      // Mark as scraping
      await ctx.runMutation(
        internal.scrapingMutations.markUrlsScraping,
        { urlIds: batch.map((u: any) => u._id) },
      );

      // Process batch with concurrency limit
      const chunks = [];
      for (let i = 0; i < batch.length; i += concurrency) {
        chunks.push(batch.slice(i, i + concurrency));
      }

      for (const chunk of chunks) {
        // Check time budget before each concurrent batch
        if (Date.now() - startTime >= TIME_BUDGET_MS - MIN_TIME_REMAINING_MS) break;

        const results = await Promise.allSettled(
          chunk.map(async (urlRecord: any) => {
            // Respect delay
            if (delay > 0) {
              await new Promise((r) => setTimeout(r, delay));
            }

            const scraped = await scraper.scrape(urlRecord.url, {
              onlyMainContent,
              timeout: 30_000,
            });

            return { urlRecord, scraped };
          }),
        );

        let batchScraped = 0;
        let batchFailed = 0;
        let batchDiscovered = 0;

        for (const result of results) {
          if (result.status === "fulfilled") {
            const { urlRecord, scraped } = result.value;

            // Persist document
            await ctx.runMutation(
              internal.scrapingMutations.persistScrapedPage,
              {
                crawlUrlId: urlRecord._id,
                orgId: job.orgId,
                kbId: job.kbId,
                title: scraped.metadata.title || urlRecord.url,
                content: scraped.markdown,
                sourceUrl: urlRecord.url,
              },
            );
            batchScraped++;

            // Discover new URLs (only if within depth limit)
            if (urlRecord.depth < maxDepth) {
              const filteredLinks = filterLinks(
                scraped.metadata.links,
                job.startUrl,
                {
                  includePaths: job.config.includePaths ?? undefined,
                  excludePaths: job.config.excludePaths ?? undefined,
                  allowSubdomains: job.config.allowSubdomains ?? false,
                },
              );

              if (filteredLinks.length > 0) {
                const newUrls = filteredLinks.map((link: string) => ({
                  url: link,
                  normalizedUrl: normalizeUrl(link),
                  depth: urlRecord.depth + 1,
                  parentUrl: urlRecord.url,
                }));

                const { inserted } = await ctx.runMutation(
                  internal.scrapingMutations.insertDiscoveredUrls,
                  { crawlJobId: args.crawlJobId, urls: newUrls },
                );
                batchDiscovered += inserted;
              }
            }
          } else {
            // Failed
            const urlRecord = chunk[results.indexOf(result)];
            const errorMsg =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);

            await ctx.runMutation(
              internal.scrapingMutations.markUrlFailed,
              { crawlUrlId: urlRecord._id, error: errorMsg },
            );
            batchFailed++;
          }
        }

        // Update job stats
        if (batchScraped > 0 || batchFailed > 0 || batchDiscovered > 0) {
          await ctx.runMutation(
            internal.scrapingMutations.updateCrawlJobStats,
            {
              jobId: args.crawlJobId,
              scrapedDelta: batchScraped,
              failedDelta: batchFailed,
              discoveredDelta: batchDiscovered,
            },
          );
          totalScraped += batchScraped;
          totalFailed += batchFailed;
          totalDiscovered += batchDiscovered;
        }
      }
    }

    return { totalScraped, totalFailed, totalDiscovered };
  },
});
```

**Step 3: Add eval-lib scraper exports to convex.json external packages**

Check if `packages/backend/convex/convex.json` needs `got-scraping` and related packages as external. Since `rag-evaluation-system` is already a workspace dependency and these are transitive deps, they should be bundled. But if `got-scraping` requires Node built-ins, it may need to be external. Verify by deploying.

**Step 4: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Deploys successfully. If `got-scraping` fails bundling, add it to `convex.json` `externalPackages`.

**Step 5: Commit**

```bash
git add packages/backend/convex/scrapingActions.ts
git commit -m "feat: add time-budgeted batchScrape action with concurrent scraping"
```

---

## Task 13: File Upload Enhancement (PDF/HTML Support)

**Files:**
- Modify: `packages/backend/convex/documents.ts`
- Modify: `packages/frontend/src/components/FileUploader.tsx`

**Step 1: Update `documents.ts` to support optional fileId and sourceType**

In `packages/backend/convex/documents.ts`, update the `create` mutation:

- Change `storageId: v.id("_storage")` to `storageId: v.optional(v.id("_storage"))` in args
- Add `sourceType: v.optional(v.string())` to args
- Pass `fileId: args.storageId` (now optional) and `sourceType: args.sourceType` to the insert

Also add a `createFromScrape` internal mutation for the scraper to use (if not already handled by `scrapingMutations.persistScrapedPage`).

**Step 2: Update FileUploader to accept PDF and HTML**

In `packages/frontend/src/components/FileUploader.tsx`:

- Change the file filter from `.md` and `.txt` only to also accept `.pdf` and `.html`
- For `.pdf` and `.html` files, still upload to storage and create the document record
- Set `sourceType` appropriately: `"pdf"` for PDF files, `"html"` for HTML files, `"markdown"` for MD/TXT
- For PDF/HTML files, the content will be the raw text (from `file.text()`) — the backend processing action can convert it later. Or for HTML files, read as text and pass through.

Update the accept attribute: `accept=".md,.txt,.pdf,.html,.htm"`

Update the file filter check:

```typescript
const ACCEPTED_EXTENSIONS = [".md", ".txt", ".pdf", ".html", ".htm"];
if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
  failed++;
  continue;
}
```

For PDF files, read content as empty string (since `file.text()` won't produce useful output for binary PDFs). The actual content extraction happens server-side.

```typescript
const isPdf = file.name.toLowerCase().endsWith(".pdf");
const content = isPdf ? "" : await file.text();
const sourceType = isPdf
  ? "pdf"
  : file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm")
    ? "html"
    : "markdown";
```

**Step 3: Verify frontend builds**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/backend/convex/documents.ts packages/frontend/src/components/FileUploader.tsx
git commit -m "feat: extend file upload to support PDF and HTML files"
```

---

## Task 14: Frontend — KBSelector Industry Filter + Import from URL

**Files:**
- Modify: `packages/frontend/src/components/KBSelector.tsx`

**Step 1: Add industry filter dropdown**

Add a `<select>` for industry filtering above the KB dropdown. Use `api.knowledgeBases.listByIndustry` instead of `api.knowledgeBases.list`:

```typescript
const [industryFilter, setIndustryFilter] = useState<string>("");

const kbs = useQuery(
  api.knowledgeBases.listByIndustry,
  { industry: industryFilter || undefined },
);
```

Add the filter select element before the KB dropdown:

```tsx
<select
  value={industryFilter}
  onChange={(e) => setIndustryFilter(e.target.value)}
  className="w-full mb-2 p-2 rounded bg-bg-elevated border border-border text-text-primary text-sm"
>
  <option value="">All Industries</option>
  <option value="finance">Finance</option>
  <option value="insurance">Insurance</option>
  <option value="healthcare">Healthcare</option>
  <option value="telecom">Telecom</option>
  <option value="education">Education</option>
  <option value="government">Government</option>
</select>
```

**Step 2: Add metadata fields to create form**

In the KB create form, add optional fields (collapsible):

```tsx
const [showAdvanced, setShowAdvanced] = useState(false);
const [industry, setIndustry] = useState("");
const [companyName, setCompanyName] = useState("");
```

Add a "Show advanced" toggle and fields for industry (dropdown), company (text input).

Pass to the create mutation:

```typescript
await createKb({
  name: newName,
  description: "",
  ...(industry ? { industry } : {}),
  ...(companyName ? { company: companyName } : {}),
});
```

**Step 3: Add "Import from URL" section**

Below the document list, add a simple URL import form:

```tsx
const [importUrl, setImportUrl] = useState("");
const [importing, setImporting] = useState(false);
const startCrawl = useMutation(api.scraping.startCrawl);

// ... in JSX:
<div className="mt-4 border-t border-border pt-4">
  <label className="block text-sm text-text-muted mb-1">Import from URL</label>
  <div className="flex gap-2">
    <input
      type="url"
      value={importUrl}
      onChange={(e) => setImportUrl(e.target.value)}
      placeholder="https://example.com/support"
      className="flex-1 p-2 rounded bg-bg-elevated border border-border text-text-primary text-sm"
    />
    <button
      onClick={async () => {
        if (!importUrl || !selectedKbId) return;
        setImporting(true);
        try {
          await startCrawl({ kbId: selectedKbId, startUrl: importUrl });
          setImportUrl("");
        } finally {
          setImporting(false);
        }
      }}
      disabled={importing || !importUrl}
      className="px-4 py-2 bg-accent text-bg-primary rounded text-sm font-medium hover:bg-accent/80 disabled:opacity-50"
    >
      {importing ? "Starting..." : "Crawl"}
    </button>
  </div>
</div>
```

**Step 4: Add crawl progress display**

Use a reactive query on `crawlJobs` to show progress:

```tsx
const crawlJobs = useQuery(
  api.scraping.listCrawlJobs,
  selectedKbId ? { kbId: selectedKbId } : "skip",
);

// Show active crawls
{crawlJobs?.filter((j) => j.status === "running").map((job) => (
  <div key={job._id} className="text-sm text-accent mt-2">
    Scraping... {job.stats.scraped}/{job.stats.discovered} pages
  </div>
))}
```

**Step 5: Verify frontend builds**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add packages/frontend/src/components/KBSelector.tsx
git commit -m "feat: add industry filter, metadata fields, and URL import to KBSelector"
```

---

## Task 15: Full Verification

**Step 1: Run all eval-lib tests**

Run: `pnpm test`
Expected: All tests pass (existing + new file processing + scraper tests).

**Step 2: Run typecheck across all packages**

Run: `pnpm typecheck && pnpm typecheck:backend`
Expected: No type errors.

**Step 3: Build all packages**

Run: `pnpm build && pnpm -C packages/frontend build`
Expected: All builds succeed.

**Step 4: Deploy backend**

Run: `cd packages/backend && npx convex dev --once`
Expected: Schema + functions deploy successfully.

**Step 5: Commit any fixes**

If any verification step fails, fix the issue and commit:

```bash
git add -A
git commit -m "fix: address verification issues from full build"
```

---

## Summary

| Task | Phase | Description | Files |
|------|-------|-------------|-------|
| 1 | 1 | Schema changes (KB metadata + crawl tables) | 1 modified |
| 2 | 1 | KB create mutation + listByIndustry query | 1 modified |
| 3 | 2 | Install file processing dependencies | 1 modified |
| 4 | 2 | HTML to markdown converter (TDD) | 2 created |
| 5 | 2 | PDF to markdown converter (TDD) | 2 created |
| 6 | 2 | File processor dispatcher + barrel export (TDD) | 4 created, 1 modified |
| 7 | 3 | Install scraper dependencies | 1 modified |
| 8 | 3 | Scraper types + link extractor (TDD) | 3 created |
| 9 | 3 | ContentScraper class (TDD) | 2 created |
| 10 | 3 | Seed companies + barrel export (TDD) | 3 created, 1 modified |
| 11 | 4 | Scraping WorkPool + crawl mutations | 3 created/modified |
| 12 | 4 | batchScrape time-budgeted action | 1 created |
| 13 | 4 | File upload enhancement (PDF/HTML) | 2 modified |
| 14 | 5 | KBSelector (industry filter + URL import) | 1 modified |
| 15 | — | Full verification | — |
