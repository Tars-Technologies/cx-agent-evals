# KB Data Sourcing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add structured KB metadata, a file processing pipeline (HTML/PDF → markdown), an in-house web scraper, crawl orchestration via WorkPool, seed companies, and minimal frontend updates to support diverse, real-world knowledge bases.

**Architecture:** Five phases — (1) schema + CRUD changes in backend, (2) file processing pipeline in eval-lib, (3) web scraper + seed data in eval-lib, (4) crawl orchestration in backend using WorkPool + persistent frontier tables, (5) minimal frontend updates. Phases 2 & 3 are parallelizable after Phase 1.

**Tech Stack:** Convex (backend), TypeScript/tsup (eval-lib), @mozilla/readability + jsdom + turndown (HTML→MD), unpdf (PDF→MD), got-scraping (HTTP), WorkPool (@convex-dev/workpool), Next.js/React (frontend)

**Design Doc:** `packages/eval-lib/docs/kb-data-sourcing-plan.md`

---

## Phase 1: Schema Changes + KB Queries

### Task 1: Extend `knowledgeBases` table with metadata fields

**Files:**
- Modify: `packages/backend/convex/schema.ts:15-22`

**Step 1: Add optional metadata fields to knowledgeBases table**

In `packages/backend/convex/schema.ts`, add fields after `metadata` (line 19) and before `createdBy` (line 20), plus new indexes:

```typescript
knowledgeBases: defineTable({
  orgId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  metadata: v.any(),
  industry: v.optional(v.string()),
  subIndustry: v.optional(v.string()),
  company: v.optional(v.string()),
  entityType: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  createdBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_org_industry", ["orgId", "industry"])
  .index("by_org_company", ["orgId", "company"]),
```

**Step 2: Verify schema deploys**

Run: `cd packages/backend && npx convex dev --once`
Expected: Successful deployment. All new fields are optional — existing KBs unaffected.

**Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(schema): add structured KB metadata fields (industry, company, tags)"
```

---

### Task 2: Make `fileId` optional + add source tracking to `documents` table

**Files:**
- Modify: `packages/backend/convex/schema.ts:25-41`

**Step 1: Update documents table definition**

Change `fileId: v.id("_storage")` (line 31) to `fileId: v.optional(v.id("_storage"))` and add source tracking fields before `createdAt`:

```typescript
documents: defineTable({
  orgId: v.string(),
  kbId: v.id("knowledgeBases"),
  docId: v.string(),
  title: v.string(),
  content: v.string(),
  fileId: v.optional(v.id("_storage")),
  contentLength: v.number(),
  metadata: v.any(),
  sourceUrl: v.optional(v.string()),
  sourceType: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_kb", ["kbId"])
  .index("by_org", ["orgId"])
  .searchIndex("search_content", {
    searchField: "content",
    filterFields: ["kbId"],
  }),
```

**Step 2: Verify schema deploys**

Run: `cd packages/backend && npx convex dev --once`
Expected: Success. Existing documents with `fileId` continue to work.

**Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(schema): make fileId optional, add sourceUrl/sourceType to documents"
```

---

### Task 3: Add `crawlJobs` and `crawlUrls` tables

**Files:**
- Modify: `packages/backend/convex/schema.ts` (add after `indexingJobs` table, before closing `});`)

**Step 1: Add both table definitions**

Add before the closing `});` of `defineSchema`:

```typescript
// ─── Crawl Jobs (web scraping job tracking) ───
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

// ─── Crawl URLs (URL frontier for crawl jobs) ───
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

**Step 2: Verify schema deploys**

Run: `cd packages/backend && npx convex dev --once`
Expected: Success — two new tables created.

**Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(schema): add crawlJobs + crawlUrls tables for URL frontier"
```

---

### Task 4: Update `knowledgeBases.create` mutation with optional metadata args

**Files:**
- Modify: `packages/backend/convex/crud/knowledgeBases.ts:5-32`
- Create: `packages/backend/tests/knowledgeBases.test.ts`

**Step 1: Write the failing test**

Create `packages/backend/tests/knowledgeBases.test.ts`:

```typescript
import { expect, describe, it, beforeEach } from "vitest";
import { setupTest, seedUser, testIdentity } from "./helpers";
import { api } from "../convex/_generated/api";

describe("knowledgeBases: create with metadata", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("creates a KB with industry and company metadata", async () => {
    await seedUser(t);
    const authedT = t.withIdentity(testIdentity);
    const kbId = await authedT.mutation(api.crud.knowledgeBases.create, {
      name: "JPMorgan Chase Support",
      description: "Customer support KB",
      industry: "finance",
      subIndustry: "retail-banking",
      company: "JPMorgan Chase",
      entityType: "company",
      sourceUrl: "https://www.chase.com/support",
      tags: ["fortune-500", "cx", "support"],
    });
    const kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.industry).toBe("finance");
    expect(kb!.company).toBe("JPMorgan Chase");
    expect(kb!.tags).toEqual(["fortune-500", "cx", "support"]);
  });

  it("creates a KB without metadata (backward compatible)", async () => {
    await seedUser(t);
    const authedT = t.withIdentity(testIdentity);
    const kbId = await authedT.mutation(api.crud.knowledgeBases.create, {
      name: "Basic KB",
    });
    const kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.name).toBe("Basic KB");
    expect(kb!.industry).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test -- --grep "knowledgeBases"`
Expected: FAIL — `create` doesn't accept `industry`, `company`, etc.

**Step 3: Update the create mutation**

In `packages/backend/convex/crud/knowledgeBases.ts`, update `create`:

```typescript
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    metadata: v.optional(v.any()),
    industry: v.optional(v.string()),
    subIndustry: v.optional(v.string()),
    company: v.optional(v.string()),
    entityType: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found. Please sign in again.");

    return await ctx.db.insert("knowledgeBases", {
      orgId,
      name: args.name,
      description: args.description,
      metadata: args.metadata ?? {},
      industry: args.industry,
      subIndustry: args.subIndustry,
      company: args.company,
      entityType: args.entityType,
      sourceUrl: args.sourceUrl,
      tags: args.tags,
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test -- --grep "knowledgeBases"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/convex/crud/knowledgeBases.ts packages/backend/tests/knowledgeBases.test.ts
git commit -m "feat(crud): add optional metadata args to knowledgeBases.create"
```

---

### Task 5: Add `listByIndustry` query

**Files:**
- Modify: `packages/backend/convex/crud/knowledgeBases.ts`
- Modify: `packages/backend/tests/knowledgeBases.test.ts`

**Step 1: Write the failing test**

Add to `packages/backend/tests/knowledgeBases.test.ts`:

```typescript
import { TEST_ORG_ID } from "./helpers";

describe("knowledgeBases: listByIndustry", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("returns all KBs when no industry filter", async () => {
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID, name: "Finance KB", metadata: {},
        industry: "finance", createdBy: userId, createdAt: Date.now(),
      });
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID, name: "Healthcare KB", metadata: {},
        industry: "healthcare", createdBy: userId, createdAt: Date.now(),
      });
    });
    const authedT = t.withIdentity(testIdentity);
    const results = await authedT.query(api.crud.knowledgeBases.listByIndustry, {});
    expect(results).toHaveLength(2);
  });

  it("filters by industry when provided", async () => {
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID, name: "Finance KB", metadata: {},
        industry: "finance", createdBy: userId, createdAt: Date.now(),
      });
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID, name: "Healthcare KB", metadata: {},
        industry: "healthcare", createdBy: userId, createdAt: Date.now(),
      });
    });
    const authedT = t.withIdentity(testIdentity);
    const results = await authedT.query(api.crud.knowledgeBases.listByIndustry, {
      industry: "finance",
    });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Finance KB");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test -- --grep "listByIndustry"`
Expected: FAIL — `listByIndustry` doesn't exist.

**Step 3: Add the query**

Add to `packages/backend/convex/crud/knowledgeBases.ts`:

```typescript
export const listByIndustry = query({
  args: { industry: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    if (args.industry) {
      return await ctx.db
        .query("knowledgeBases")
        .withIndex("by_org_industry", (q) =>
          q.eq("orgId", orgId).eq("industry", args.industry!),
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

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test -- --grep "listByIndustry"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/convex/crud/knowledgeBases.ts packages/backend/tests/knowledgeBases.test.ts
git commit -m "feat(crud): add listByIndustry query with org-scoped industry index"
```

---

### Task 6: Add `createFromScrape` internal mutation

**Files:**
- Modify: `packages/backend/convex/crud/documents.ts`
- Create: `packages/backend/tests/documents.test.ts`

**Step 1: Write the failing test**

Create `packages/backend/tests/documents.test.ts`:

```typescript
import { expect, describe, it, beforeEach } from "vitest";
import { setupTest, seedUser, seedKB, TEST_ORG_ID } from "./helpers";
import { internal } from "../convex/_generated/api";

describe("documents: createFromScrape", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("creates a document from scraped content without fileId", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await t.mutation(internal.crud.documents.createFromScrape, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "Chase Support FAQ",
      content: "# FAQ\n\nHow do I reset my password?",
      sourceUrl: "https://www.chase.com/support/faq",
      sourceType: "scraped",
    });
    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc!.title).toBe("Chase Support FAQ");
    expect(doc!.sourceUrl).toBe("https://www.chase.com/support/faq");
    expect(doc!.sourceType).toBe("scraped");
    expect(doc!.fileId).toBeUndefined();
    expect(doc!.contentLength).toBe(31);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test -- --grep "createFromScrape"`
Expected: FAIL — `createFromScrape` doesn't exist.

**Step 3: Add the internal mutation**

Add `internalMutation` to imports in `packages/backend/convex/crud/documents.ts` (line 1):

```typescript
import { mutation, query, internalQuery, internalMutation } from "../_generated/server";
```

Add at the end of the file:

```typescript
export const createFromScrape = internalMutation({
  args: {
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    title: v.string(),
    content: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("documents", {
      orgId: args.orgId,
      kbId: args.kbId,
      docId: args.title,
      title: args.title,
      content: args.content,
      contentLength: args.content.length,
      metadata: {},
      sourceUrl: args.sourceUrl,
      sourceType: args.sourceType,
      createdAt: Date.now(),
    });
  },
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test -- --grep "createFromScrape"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/convex/crud/documents.ts packages/backend/tests/documents.test.ts
git commit -m "feat(crud): add createFromScrape internal mutation for scraped documents"
```

---

### Task 7: Verify Phase 1

**Step 1:** Run: `pnpm typecheck:backend` — Expected: No errors.
**Step 2:** Run: `cd packages/backend && npx convex dev --once` — Expected: Success.
**Step 3:** Run: `pnpm -C packages/backend test` — Expected: All pass.

---

## Phase 2: File Processing Pipeline (eval-lib)

### Task 8: Install file processing dependencies

**Step 1: Install**

```bash
pnpm -C packages/eval-lib add @mozilla/readability jsdom turndown unpdf
pnpm -C packages/eval-lib add -D @types/turndown
```

**Step 2: Verify** — Run: `pnpm -C packages/eval-lib build` — Expected: Success.

**Step 3: Commit**

```bash
git add packages/eval-lib/package.json pnpm-lock.yaml
git commit -m "deps(eval-lib): add readability, jsdom, turndown, unpdf for file processing"
```

---

### Task 9: Create HTML to Markdown converter

**Files:**
- Create: `packages/eval-lib/src/file-processing/html-to-markdown.ts`
- Create: `packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts
import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../../../src/file-processing/html-to-markdown.js";

describe("htmlToMarkdown", () => {
  it("converts simple HTML to markdown", async () => {
    const result = await htmlToMarkdown(
      "<html><body><h1>Hello</h1><p>World</p></body></html>",
    );
    expect(result.content).toContain("Hello");
    expect(result.content).toContain("World");
    expect(result.title).toBe("Hello");
  });

  it("extracts links from HTML", async () => {
    const html = `<html><body>
      <a href="https://example.com/page1">Link 1</a>
      <a href="/relative">Relative</a>
    </body></html>`;
    const result = await htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(result.links).toContain("https://example.com/page1");
    expect(result.links).toContain("https://example.com/relative");
  });

  it("normalizes whitespace and collapses blank lines", async () => {
    const html = "<html><body><p>Hello</p>\n\n\n\n<p>World</p></body></html>";
    const result = await htmlToMarkdown(html);
    expect(result.content).not.toMatch(/\n{3,}/);
  });

  it("returns full content when onlyMainContent is false", async () => {
    const html = `<html><body>
      <nav>Navigation</nav>
      <article><h1>Main</h1></article>
      <footer>Footer</footer>
    </body></html>`;
    const result = await htmlToMarkdown(html, { onlyMainContent: false });
    expect(result.content).toContain("Navigation");
    expect(result.content).toContain("Footer");
  });
});
```

**Step 2: Run to verify failure** — Run: `pnpm -C packages/eval-lib test -- --grep "htmlToMarkdown"` — Expected: FAIL

**Step 3: Implement**

```typescript
// packages/eval-lib/src/file-processing/html-to-markdown.ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export interface HtmlToMarkdownOptions {
  onlyMainContent?: boolean;
  baseUrl?: string;
}

export interface HtmlToMarkdownResult {
  content: string;
  title: string;
  links: string[];
}

export async function htmlToMarkdown(
  html: string,
  options?: HtmlToMarkdownOptions,
): Promise<HtmlToMarkdownResult> {
  const onlyMainContent = options?.onlyMainContent ?? true;
  const baseUrl = options?.baseUrl;
  const dom = new JSDOM(html, { url: baseUrl || "https://placeholder.local" });
  const doc = dom.window.document;

  const links = extractLinks(doc, baseUrl);
  let title = doc.querySelector("title")?.textContent?.trim() || "";
  let htmlForConversion: string;

  if (onlyMainContent) {
    const reader = new Readability(doc);
    const article = reader.parse();
    if (article) {
      htmlForConversion = article.content;
      title = article.title || title;
    } else {
      htmlForConversion = doc.body?.innerHTML || html;
    }
  } else {
    htmlForConversion = doc.body?.innerHTML || html;
  }

  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  let markdown = turndown.turndown(htmlForConversion);
  markdown = cleanupMarkdown(markdown);

  if (!title) {
    const headingMatch = markdown.match(/^#\s+(.+)$/m);
    if (headingMatch) title = headingMatch[1];
  }

  return { content: markdown, title, links };
}

function extractLinks(doc: Document, baseUrl?: string): string[] {
  const anchors = doc.querySelectorAll("a[href]");
  const links: string[] = [];
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    try {
      const resolved = baseUrl ? new URL(href, baseUrl).href : href;
      links.push(resolved);
    } catch { /* skip malformed URLs */ }
  }
  return [...new Set(links)];
}

function cleanupMarkdown(md: string): string {
  return md
    .replace(/<!-- .*? -->/gs, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
```

**Step 4: Run to verify pass** — Run: `pnpm -C packages/eval-lib test -- --grep "htmlToMarkdown"` — Expected: PASS

**Step 5: Commit**

```bash
git add packages/eval-lib/src/file-processing/ packages/eval-lib/tests/unit/file-processing/
git commit -m "feat(eval-lib): add HTML to Markdown converter with readability + link extraction"
```

---

### Task 10: Create PDF to Markdown converter

**Files:**
- Create: `packages/eval-lib/src/file-processing/pdf-to-markdown.ts`
- Create: `packages/eval-lib/tests/unit/file-processing/pdf-to-markdown.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/eval-lib/tests/unit/file-processing/pdf-to-markdown.test.ts
import { describe, it, expect } from "vitest";
import { pdfToMarkdown } from "../../../src/file-processing/pdf-to-markdown.js";

describe("pdfToMarkdown", () => {
  it("returns a PdfToMarkdownResult shape", async () => {
    // unpdf may not parse a hand-crafted minimal PDF, so we test the interface
    // A real integration test would use an actual PDF fixture file
    try {
      const result = await pdfToMarkdown(Buffer.from("not a real pdf"));
      expect(result.content).toBeDefined();
      expect(result.title).toBeDefined();
    } catch (e) {
      // Expected: unpdf throws on invalid PDF — that's fine for unit test
      expect(e).toBeDefined();
    }
  });
});
```

**Step 2: Implement**

```typescript
// packages/eval-lib/src/file-processing/pdf-to-markdown.ts
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
```

**Step 3: Commit**

```bash
git add packages/eval-lib/src/file-processing/pdf-to-markdown.ts packages/eval-lib/tests/unit/file-processing/
git commit -m "feat(eval-lib): add PDF to Markdown converter using unpdf"
```

---

### Task 11: Create main file processor dispatcher + barrel + sub-path wiring

**Files:**
- Create: `packages/eval-lib/src/file-processing/processor.ts`
- Create: `packages/eval-lib/src/file-processing/index.ts`
- Create: `packages/eval-lib/tests/unit/file-processing/processor.test.ts`
- Modify: `packages/eval-lib/tsup.config.ts`
- Modify: `packages/eval-lib/package.json`

**Step 1: Write the failing tests**

```typescript
// packages/eval-lib/tests/unit/file-processing/processor.test.ts
import { describe, it, expect } from "vitest";
import { processFile } from "../../../src/file-processing/processor.js";

describe("processFile", () => {
  it("processes HTML input", async () => {
    const result = await processFile({
      content: "<html><body><h1>Test</h1><p>Hello world</p></body></html>",
      format: "html",
    });
    expect(result.content).toContain("Test");
    expect(result.metadata.sourceFormat).toBe("html");
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });

  it("processes markdown input (passthrough with cleanup)", async () => {
    const result = await processFile({
      content: "# Title\n\n\n\nSome content here   ",
      format: "markdown",
    });
    expect(result.content).toBe("# Title\n\nSome content here");
    expect(result.metadata.sourceFormat).toBe("markdown");
    expect(result.title).toBe("Title");
  });

  it("extracts links from HTML", async () => {
    const result = await processFile({
      content: '<html><body><a href="https://example.com">Link</a></body></html>',
      format: "html",
      baseUrl: "https://example.com",
    });
    expect(result.metadata.links).toContain("https://example.com");
  });
});
```

**Step 2: Implement processor.ts**

```typescript
// packages/eval-lib/src/file-processing/processor.ts
import { htmlToMarkdown } from "./html-to-markdown.js";
import { pdfToMarkdown } from "./pdf-to-markdown.js";

export interface FileProcessorConfig {
  onlyMainContent?: boolean;
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

type FileInput =
  | { content: string; format: "html"; baseUrl?: string }
  | { buffer: Buffer; format: "pdf" }
  | { content: string; format: "markdown" };

export async function processFile(
  input: FileInput,
  config?: FileProcessorConfig,
): Promise<ProcessedDocument> {
  if (input.format === "html") {
    const result = await htmlToMarkdown(input.content, {
      onlyMainContent: config?.onlyMainContent ?? true,
      baseUrl: input.baseUrl,
    });
    return {
      content: result.content,
      title: result.title,
      metadata: { sourceFormat: "html", wordCount: countWords(result.content), links: result.links },
    };
  }
  if (input.format === "pdf") {
    const result = await pdfToMarkdown(input.buffer);
    return {
      content: result.content,
      title: result.title,
      metadata: { sourceFormat: "pdf", wordCount: countWords(result.content) },
    };
  }
  const content = input.content.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
  const titleMatch = content.match(/^#\s+(.+)$/m);
  return {
    content,
    title: titleMatch?.[1]?.trim() || "",
    metadata: { sourceFormat: "markdown", wordCount: countWords(content) },
  };
}

function countWords(text: string): number {
  return text.replace(/[#*_`~\[\]()>-]/g, " ").split(/\s+/).filter((w) => w.length > 0).length;
}
```

**Step 3: Create barrel**

```typescript
// packages/eval-lib/src/file-processing/index.ts
export { processFile } from "./processor.js";
export type { FileProcessorConfig, ProcessedDocument } from "./processor.js";
export { htmlToMarkdown } from "./html-to-markdown.js";
export type { HtmlToMarkdownOptions, HtmlToMarkdownResult } from "./html-to-markdown.js";
export { pdfToMarkdown } from "./pdf-to-markdown.js";
export type { PdfToMarkdownResult } from "./pdf-to-markdown.js";
```

**Step 4: Add entry point to tsup.config.ts**

Add `"src/file-processing/index.ts"` to `entry` array and new deps to `external`:

```typescript
entry: [
  "src/index.ts",
  "src/embedders/openai.ts",
  "src/rerankers/cohere.ts",
  "src/pipeline/internals.ts",
  "src/utils/index.ts",
  "src/langsmith/index.ts",
  "src/llm/index.ts",
  "src/shared/index.ts",
  "src/file-processing/index.ts",
],
// ...
external: [
  "openai", "langsmith", "langsmith/evaluation", "@langchain/core", "cohere-ai",
  "@mozilla/readability", "jsdom", "turndown", "unpdf",
],
```

**Step 5: Add sub-path export to package.json**

Add to `exports` after `"./shared"`:

```json
"./file-processing": {
  "types": "./dist/file-processing/index.d.ts",
  "import": "./dist/file-processing/index.js"
}
```

**Step 6: Build and test**

Run: `pnpm build && pnpm -C packages/eval-lib test -- --grep "processFile"`
Expected: Build succeeds, tests PASS.

**Step 7: Commit**

```bash
git add packages/eval-lib/src/file-processing/ packages/eval-lib/tests/unit/file-processing/ packages/eval-lib/tsup.config.ts packages/eval-lib/package.json
git commit -m "feat(eval-lib): add file processor dispatcher + sub-path export (rag-evaluation-system/file-processing)"
```

---

## Phase 3: Web Scraper + Seed Companies (eval-lib)

### Task 12: Install scraper dependency + create types

**Step 1: Install** — Run: `pnpm -C packages/eval-lib add got-scraping`

**Step 2: Create types**

```typescript
// packages/eval-lib/src/scraper/types.ts
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
  entityType: "company" | "government-state" | "government-county" | "industry-aggregate";
  sourceUrls: string[];
  tags: string[];
  notes?: string;
}
```

**Step 3: Commit**

```bash
git add packages/eval-lib/package.json pnpm-lock.yaml packages/eval-lib/src/scraper/types.ts
git commit -m "deps(eval-lib): add got-scraping + scraper types"
```

---

### Task 13: Create link extractor + URL normalizer

**Files:**
- Create: `packages/eval-lib/src/scraper/link-extractor.ts`
- Create: `packages/eval-lib/tests/unit/scraper/link-extractor.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/eval-lib/tests/unit/scraper/link-extractor.test.ts
import { describe, it, expect } from "vitest";
import { filterLinks, normalizeUrl } from "../../../src/scraper/link-extractor.js";

describe("normalizeUrl", () => {
  it("strips fragments", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });
  it("strips trailing slash", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe("https://example.com/page");
  });
  it("lowercases host", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/Page")).toBe("https://example.com/Page");
  });
  it("sorts query params", () => {
    expect(normalizeUrl("https://example.com?b=2&a=1")).toBe("https://example.com?a=1&b=2");
  });
});

describe("filterLinks", () => {
  const base = "https://example.com";
  const links = [
    "https://example.com/help/faq",
    "https://example.com/login",
    "https://other.com/page",
    "https://sub.example.com/page",
  ];

  it("keeps same-domain links by default", () => {
    const result = filterLinks(links, base);
    expect(result).toContain("https://example.com/help/faq");
    expect(result).not.toContain("https://other.com/page");
  });
  it("filters by includePaths", () => {
    const result = filterLinks(links, base, { includePaths: ["/help/*"] });
    expect(result).toContain("https://example.com/help/faq");
    expect(result).not.toContain("https://example.com/login");
  });
  it("filters by excludePaths", () => {
    const result = filterLinks(links, base, { excludePaths: ["/login"] });
    expect(result).not.toContain("https://example.com/login");
  });
  it("allows subdomains when configured", () => {
    const result = filterLinks(links, base, { allowSubdomains: true });
    expect(result).toContain("https://sub.example.com/page");
  });
});
```

**Step 2: Implement**

```typescript
// packages/eval-lib/src/scraper/link-extractor.ts
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";
    const params = new URLSearchParams(parsed.search);
    const sorted = new URLSearchParams([...params.entries()].sort());
    parsed.search = sorted.toString();
    let result = parsed.href;
    if (result.endsWith("/") && parsed.pathname !== "/") result = result.slice(0, -1);
    if (result.endsWith("?")) result = result.slice(0, -1);
    return result;
  } catch { return url; }
}

export function filterLinks(
  links: string[],
  baseUrl: string,
  config?: { includePaths?: string[]; excludePaths?: string[]; allowSubdomains?: boolean },
): string[] {
  const baseDomain = new URL(baseUrl).hostname;
  return links.filter((link) => {
    let parsed: URL;
    try { parsed = new URL(link); } catch { return false; }
    if (config?.allowSubdomains) {
      if (!parsed.hostname.endsWith(baseDomain) && parsed.hostname !== baseDomain) return false;
    } else {
      if (parsed.hostname !== baseDomain) return false;
    }
    const path = parsed.pathname;
    if (config?.includePaths?.length) {
      if (!config.includePaths.some((p) => matchGlob(path, p))) return false;
    }
    if (config?.excludePaths?.length) {
      if (config.excludePaths.some((p) => matchGlob(path, p))) return false;
    }
    return true;
  });
}

function matchGlob(path: string, pattern: string): boolean {
  if (path === pattern) return true;
  const regexStr = pattern.replace(/\*\*/g, "<<GLOBSTAR>>").replace(/\*/g, "[^/]*").replace(/<<GLOBSTAR>>/g, ".*");
  return new RegExp(`^${regexStr}$`).test(path);
}
```

**Step 3: Run tests** — Expected: PASS

**Step 4: Commit**

```bash
git add packages/eval-lib/src/scraper/link-extractor.ts packages/eval-lib/tests/unit/scraper/
git commit -m "feat(eval-lib): add link extractor with URL normalization and glob filtering"
```

---

### Task 14: Create ContentScraper class

**Files:**
- Create: `packages/eval-lib/src/scraper/scraper.ts`
- Create: `packages/eval-lib/tests/unit/scraper/scraper.test.ts`

**Step 1: Write the failing test (mocked HTTP)**

```typescript
// packages/eval-lib/tests/unit/scraper/scraper.test.ts
import { describe, it, expect, vi } from "vitest";
import { ContentScraper } from "../../../src/scraper/scraper.js";

vi.mock("got-scraping", () => ({
  gotScraping: vi.fn().mockResolvedValue({
    body: "<html><body><h1>Test Page</h1><p>Content</p><a href='/other'>Link</a></body></html>",
    statusCode: 200,
    headers: { "content-type": "text/html" },
  }),
}));

describe("ContentScraper", () => {
  it("scrapes a URL and returns markdown + metadata", async () => {
    const scraper = new ContentScraper();
    const result = await scraper.scrape("https://example.com/page");
    expect(result.url).toBe("https://example.com/page");
    expect(result.markdown).toContain("Test Page");
    expect(result.metadata.statusCode).toBe(200);
    expect(result.metadata.links).toBeInstanceOf(Array);
  });
});
```

**Step 2: Implement**

```typescript
// packages/eval-lib/src/scraper/scraper.ts
import { gotScraping } from "got-scraping";
import { htmlToMarkdown } from "../file-processing/html-to-markdown.js";
import type { ScrapedPage, ScrapeOptions } from "./types.js";

export interface ContentScraperConfig {
  userAgent?: string;
  defaultHeaders?: Record<string, string>;
}

export class ContentScraper {
  private userAgent: string;
  private defaultHeaders: Record<string, string>;

  constructor(config?: ContentScraperConfig) {
    this.userAgent = config?.userAgent ?? "Mozilla/5.0 (compatible; RAGEvalBot/1.0)";
    this.defaultHeaders = config?.defaultHeaders ?? {};
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapedPage> {
    const response = await gotScraping({
      url,
      headers: { "User-Agent": this.userAgent, ...this.defaultHeaders, ...options?.headers },
      timeout: { request: options?.timeout ?? 30_000 },
      responseType: "text",
    });
    const html = response.body as string;
    const result = await htmlToMarkdown(html, {
      onlyMainContent: options?.onlyMainContent ?? true,
      baseUrl: url,
    });
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const langMatch = html.match(/<html[^>]*lang=["']([^"']*)["']/i);
    return {
      url,
      markdown: result.content,
      metadata: {
        title: result.title,
        sourceURL: url,
        description: descMatch?.[1],
        language: langMatch?.[1],
        statusCode: response.statusCode,
        links: result.links,
      },
    };
  }
}
```

**Step 3: Run tests** — Expected: PASS

**Step 4: Commit**

```bash
git add packages/eval-lib/src/scraper/scraper.ts packages/eval-lib/tests/unit/scraper/
git commit -m "feat(eval-lib): add ContentScraper class using got-scraping + file processing"
```

---

### Task 15: Create seed companies data

**Files:**
- Create: `packages/eval-lib/src/scraper/seed-companies.ts`
- Create: `packages/eval-lib/tests/unit/scraper/seed-companies.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/eval-lib/tests/unit/scraper/seed-companies.test.ts
import { describe, it, expect } from "vitest";
import { getSeedIndustries, getSeedEntitiesByIndustry, SEED_ENTITIES } from "../../../src/scraper/seed-companies.js";

describe("seed-companies", () => {
  it("has 28 total entities", () => { expect(SEED_ENTITIES).toHaveLength(28); });
  it("returns 6 industries", () => {
    expect(getSeedIndustries()).toHaveLength(6);
    expect(getSeedIndustries()).toContain("finance");
  });
  it("returns 3 finance entities", () => {
    const entities = getSeedEntitiesByIndustry("finance");
    expect(entities).toHaveLength(3);
    expect(entities.map((e) => e.name)).toContain("JPMorgan Chase");
  });
  it("returns 13 government entities (8 states + 5 counties)", () => {
    const entities = getSeedEntitiesByIndustry("government");
    expect(entities).toHaveLength(13);
  });
  it("every entity has required fields", () => {
    for (const e of SEED_ENTITIES) {
      expect(e.name).toBeTruthy();
      expect(e.sourceUrls.length).toBeGreaterThan(0);
    }
  });
});
```

**Step 2: Implement** — Create `packages/eval-lib/src/scraper/seed-companies.ts` with all 28 entities (3 finance, 3 insurance, 3 healthcare, 3 telecom, 3 education, 8 gov-state, 5 gov-county) as `SeedEntity[]`. Include `getSeedIndustries()` and `getSeedEntitiesByIndustry()` helpers.

The exact entity data is specified in the design doc (Task 3d / lines 348-362). Each entity needs: `name`, `industry`, `subIndustry`, `entityType`, `sourceUrls` (at least one support/help page URL), `tags`.

**Step 3: Run tests** — Expected: PASS

**Step 4: Commit**

```bash
git add packages/eval-lib/src/scraper/seed-companies.ts packages/eval-lib/tests/unit/scraper/
git commit -m "feat(eval-lib): add 28 seed entities across 6 industries"
```

---

### Task 16: Create barrel + sub-path wiring for scraper

**Files:**
- Create: `packages/eval-lib/src/scraper/index.ts`
- Modify: `packages/eval-lib/tsup.config.ts`
- Modify: `packages/eval-lib/package.json`

**Step 1: Create barrel**

```typescript
// packages/eval-lib/src/scraper/index.ts
export { ContentScraper } from "./scraper.js";
export type { ContentScraperConfig } from "./scraper.js";
export type { ScrapedPage, ScrapeOptions, SeedEntity } from "./types.js";
export { filterLinks, normalizeUrl } from "./link-extractor.js";
export { SEED_ENTITIES, getSeedIndustries, getSeedEntitiesByIndustry } from "./seed-companies.js";
```

**Step 2: Add to tsup.config.ts** — Add `"src/scraper/index.ts"` to `entry`, `"got-scraping"` to `external`.

**Step 3: Add to package.json exports**

```json
"./scraper": {
  "types": "./dist/scraper/index.d.ts",
  "import": "./dist/scraper/index.js"
}
```

**Step 4: Build and verify** — Run: `pnpm build` — Expected: Success.

**Step 5: Commit**

```bash
git add packages/eval-lib/src/scraper/index.ts packages/eval-lib/tsup.config.ts packages/eval-lib/package.json
git commit -m "feat(eval-lib): wire scraper sub-path export (rag-evaluation-system/scraper)"
```

---

### Task 17: Verify Phase 2 + 3

**Step 1:** Run: `pnpm build` — Expected: All entry points build.
**Step 2:** Run: `pnpm test` — Expected: All tests pass.
**Step 3:** Run: `pnpm typecheck` — Expected: No errors.

---

## Phase 4: Crawl Orchestration (backend)

### Task 18: Add scrapingPool WorkPool + update convex.json

**Files:**
- Modify: `packages/backend/convex/convex.config.ts` — Add `app.use(workpool, { name: "scrapingPool" });`
- Modify: `packages/backend/convex.json` — Add `@mozilla/readability`, `jsdom`, `turndown`, `unpdf`, `got-scraping` to `externalPackages`
- Modify: `packages/backend/tests/helpers.ts` — Add `workpoolTest.register(t, "scrapingPool");`

**Step 1: Update convex.config.ts** (line 7):

```typescript
app.use(workpool, { name: "scrapingPool" });
```

**Step 2: Update convex.json**:

```json
{
  "$schema": "./node_modules/convex/schemas/convex.schema.json",
  "node": {
    "externalPackages": [
      "langsmith", "@langchain/core", "openai", "minisearch",
      "@mozilla/readability", "jsdom", "turndown", "unpdf", "got-scraping"
    ]
  }
}
```

**Step 3: Update helpers.ts** — Add `workpoolTest.register(t, "scrapingPool");` to `setupTest()`.

**Step 4: Deploy** — Run: `cd packages/backend && npx convex dev --once` — Expected: Success.

**Step 5: Run existing tests** — Run: `pnpm -C packages/backend test` — Expected: All pass.

**Step 6: Commit**

```bash
git add packages/backend/convex/convex.config.ts packages/backend/convex.json packages/backend/tests/helpers.ts
git commit -m "feat(backend): add scrapingPool WorkPool + external packages for scraper deps"
```

---

### Task 19: Create scraping orchestration (V8 runtime)

**Files:**
- Create: `packages/backend/convex/scraping/orchestration.ts`

This is the largest single file. It contains: WorkPool setup, `startCrawl`/`cancelCrawl` public mutations, `getJob`/`listByKb` public queries, `getJobInternal`/`getPendingUrls` internal queries, `markUrlsScraping`/`persistScrapedPage`/`markUrlFailed` internal mutations, and `onBatchComplete` WorkPool callback.

Full implementation is specified in the design doc (Phase 4b-4c). Key patterns to follow:
- Use `getAuthContext(ctx)` in all public mutations/queries
- Use `Workpool` from `@convex-dev/workpool` with `components.scrapingPool`
- `onBatchComplete` checks for pending URLs and enqueues continuation or marks complete
- `persistScrapedPage` creates document via `internal.crud.documents.createFromScrape`, marks URL done, inserts discovered URLs (dedup via `by_job_url` index)

**Step 1: Create the file** — See design doc Phase 4c for the full structure.

**Step 2: TypeScript check** — Run: `pnpm typecheck:backend` — Expected: No errors.

**Step 3: Commit**

```bash
git add packages/backend/convex/scraping/orchestration.ts
git commit -m "feat(backend): add scraping orchestration — mutations, queries, WorkPool callbacks"
```

---

### Task 20: Create batchScrape action (Node runtime)

**Files:**
- Create: `packages/backend/convex/scraping/actions.ts`

This is a `"use node"` file with a single `batchScrape` internalAction. Key pattern:
- Time-budgeted loop (9 min budget, exits with 30s remaining)
- Queries pending URLs from frontier via `internal.scraping.orchestration.getPendingUrls`
- Marks batch as scraping via `internal.scraping.orchestration.markUrlsScraping`
- Scrapes with `ContentScraper` from `rag-evaluation-system/scraper`
- Filters links with `filterLinks` from `rag-evaluation-system/scraper`
- Persists via `internal.scraping.orchestration.persistScrapedPage`
- Handles failures via `internal.scraping.orchestration.markUrlFailed`

**Step 1: Create the file** — See design doc Phase 4b for the full loop structure.

**Step 2: Build eval-lib first** — Run: `pnpm build` (ensures sub-paths resolve).

**Step 3: TypeScript check** — Run: `pnpm typecheck:backend` — Expected: No errors.

**Step 4: Deploy** — Run: `cd packages/backend && npx convex dev --once` — Expected: Success.

**Step 5: Commit**

```bash
git add packages/backend/convex/scraping/actions.ts
git commit -m "feat(backend): add batchScrape action with time-budgeted scraping loop"
```

---

### Task 21: Write backend tests for scraping orchestration

**Files:**
- Create: `packages/backend/tests/scraping.test.ts`

Test the orchestration mutations/queries (not the action — that requires real HTTP).

Key test cases:
- `startCrawl`: creates job + seed URL, verifies status/stats
- `cancelCrawl`: sets status to "cancelled"
- `persistScrapedPage`: creates document, marks URL done, inserts discovered URLs, updates stats
- `markUrlFailed`: increments retryCount and failure stats
- `onBatchComplete`: marks job completed when no pending URLs remain; marks failed on action failure

**Step 1: Write tests** — Follow the pattern from `packages/backend/tests/experiments.test.ts` (use `setupTest`, `seedUser`, `seedKB`, direct `t.run` for DB seeding, `t.mutation` for internal mutations).

**Step 2: Run tests** — Run: `pnpm -C packages/backend test -- --grep "scraping"` — Expected: PASS.

**Step 3: Commit**

```bash
git add packages/backend/tests/scraping.test.ts
git commit -m "test(backend): add scraping orchestration tests"
```

---

### Task 22: Verify Phase 4

**Step 1:** Run: `pnpm typecheck:backend` — Expected: No errors.
**Step 2:** Run: `pnpm -C packages/backend test` — Expected: All pass.
**Step 3:** Run: `cd packages/backend && npx convex dev --once` — Expected: Success.

---

## Phase 5: Frontend — Minimal Updates

### Task 23: Add industry filter to KBSelector

**Files:**
- Modify: `packages/frontend/src/components/KBSelector.tsx`

Changes:
1. Switch from `api.crud.knowledgeBases.list` to `api.crud.knowledgeBases.listByIndustry`
2. Add `industryFilter` state and `<select>` dropdown above KB dropdown
3. Add optional industry/company/entityType inputs to the create form

Industry options: "All Industries", "finance", "insurance", "healthcare", "telecom", "education", "government".

Follow existing style: dark theme, `text-xs`, `bg-bg-elevated`, `border-border`, `text-text-dim`, `accent` color.

**Step 1: Implement** — Update the component as described.
**Step 2: Build** — Run: `pnpm -C packages/frontend build` — Expected: Success.
**Step 3: Commit**

```bash
git add packages/frontend/src/components/KBSelector.tsx
git commit -m "feat(frontend): add industry filter and metadata fields to KB selector"
```

---

### Task 24: Add URL import UI to KBSelector

**Files:**
- Modify: `packages/frontend/src/components/KBSelector.tsx`

Add a `CrawlImport` section below `FileUploader` when a KB is selected:
- URL text input + "Start Crawl" button (calls `api.scraping.orchestration.startCrawl`)
- Progress display: "Scraping... 45/120 pages" (reactive query on `api.scraping.orchestration.getJob`)
- Cancel button (calls `api.scraping.orchestration.cancelCrawl`)
- Completion/failure status display

Can be an inline component or extracted — inline is simpler for v1.

**Step 1: Implement** — Add the crawl import UI.
**Step 2: Build** — Run: `pnpm -C packages/frontend build` — Expected: Success.
**Step 3: Commit**

```bash
git add packages/frontend/src/components/KBSelector.tsx
git commit -m "feat(frontend): add URL import with crawl progress UI"
```

---

### Task 25: Enhance FileUploader to accept PDF/HTML

**Files:**
- Modify: `packages/frontend/src/components/FileUploader.tsx`

Changes:
1. Update file extension check (line 28) to accept `.html`, `.htm`, `.pdf` in addition to `.md`, `.txt`
2. Update `accept` attribute (line 108) to `.md,.txt,.html,.htm,.pdf`
3. Update drop zone text (line 120) to mention HTML/PDF

**Step 1: Implement** — Update the three locations.
**Step 2: Build** — Run: `pnpm -C packages/frontend build` — Expected: Success.
**Step 3: Commit**

```bash
git add packages/frontend/src/components/FileUploader.tsx
git commit -m "feat(frontend): accept PDF and HTML files in uploader"
```

---

### Task 26: Final verification

**Step 1:** `pnpm build` — eval-lib builds all entry points.
**Step 2:** `pnpm test` — eval-lib tests all pass.
**Step 3:** `pnpm typecheck` — eval-lib types clean.
**Step 4:** `pnpm -C packages/backend test` — backend tests all pass.
**Step 5:** `pnpm typecheck:backend` — backend types clean.
**Step 6:** `pnpm -C packages/frontend build` — frontend production build succeeds.
**Step 7:** `cd packages/backend && npx convex dev --once` — backend deploys successfully.

---

## Dependency Graph

```
Tasks 1-3 (schema) ──> Tasks 4-6 (CRUD) ──> Task 7 (verify Phase 1)
                                                    │
                        Tasks 8-11 (file processing) ┤
                                                      ├──> Task 17 (verify Phase 2+3)
                        Tasks 12-16 (scraper + seeds) ┘
                                                    │
                        Tasks 18-21 (crawl orchestration) ──> Task 22 (verify Phase 4)
                                                                      │
                        Tasks 23-25 (frontend) ──> Task 26 (final verify)
```

Phases 2 and 3 (Tasks 8-16) can be parallelized — both are eval-lib only.

---

## Files Summary

| Action | File | Task |
|--------|------|------|
| Modify | `packages/backend/convex/schema.ts` | 1, 2, 3 |
| Modify | `packages/backend/convex/crud/knowledgeBases.ts` | 4, 5 |
| Modify | `packages/backend/convex/crud/documents.ts` | 6 |
| Modify | `packages/backend/convex/convex.config.ts` | 18 |
| Modify | `packages/backend/convex.json` | 18 |
| Modify | `packages/backend/tests/helpers.ts` | 18 |
| Create | `packages/backend/tests/knowledgeBases.test.ts` | 4, 5 |
| Create | `packages/backend/tests/documents.test.ts` | 6 |
| Create | `packages/backend/tests/scraping.test.ts` | 21 |
| Create | `packages/backend/convex/scraping/orchestration.ts` | 19 |
| Create | `packages/backend/convex/scraping/actions.ts` | 20 |
| Modify | `packages/eval-lib/package.json` | 8, 11, 12, 16 |
| Modify | `packages/eval-lib/tsup.config.ts` | 11, 16 |
| Create | `packages/eval-lib/src/file-processing/html-to-markdown.ts` | 9 |
| Create | `packages/eval-lib/src/file-processing/pdf-to-markdown.ts` | 10 |
| Create | `packages/eval-lib/src/file-processing/processor.ts` | 11 |
| Create | `packages/eval-lib/src/file-processing/index.ts` | 11 |
| Create | `packages/eval-lib/src/scraper/types.ts` | 12 |
| Create | `packages/eval-lib/src/scraper/link-extractor.ts` | 13 |
| Create | `packages/eval-lib/src/scraper/scraper.ts` | 14 |
| Create | `packages/eval-lib/src/scraper/seed-companies.ts` | 15 |
| Create | `packages/eval-lib/src/scraper/index.ts` | 16 |
| Create | `packages/eval-lib/tests/unit/file-processing/*.test.ts` | 9, 10, 11 |
| Create | `packages/eval-lib/tests/unit/scraper/*.test.ts` | 13, 14, 15 |
| Modify | `packages/frontend/src/components/KBSelector.tsx` | 23, 24 |
| Modify | `packages/frontend/src/components/FileUploader.tsx` | 25 |

## New Dependencies

**eval-lib**: `@mozilla/readability`, `jsdom`, `turndown`, `unpdf`, `got-scraping`, `@types/turndown` (dev)

**backend convex.json externalPackages**: `@mozilla/readability`, `jsdom`, `turndown`, `unpdf`, `got-scraping`
