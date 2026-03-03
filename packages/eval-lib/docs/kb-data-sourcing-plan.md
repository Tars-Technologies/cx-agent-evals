# KB Data Sourcing Plan

> Successor to `multi-industry-kb-plan.md`. Covers structured KB metadata, file processing pipeline (HTML/PDF/MD → markdown), in-house web scraper, crawl orchestration, seed companies, and frontend updates.

## Context

The RAG evaluation system needs diverse, real-world knowledge bases spanning multiple industries (finance, insurance, healthcare, telecom, education, government). Today, KBs are flat (name + description) and documents can only be uploaded as `.md`/`.txt` files from the browser.

This plan introduces:

1. **Structured KB metadata** — industry, company, entity type, tags
2. **File processing pipeline** — converts HTML, PDF, and raw markdown into clean markdown
3. **In-house web scraper** — Firecrawl-inspired single-page scraper with link extraction
4. **Crawl orchestration** — reliable, time-budgeted batch scraping via Convex WorkPool
5. **Seed company list** — 28 entities across 6 industries for initial benchmarking
6. **Minimal frontend updates** — industry filter, URL import, PDF/HTML upload support

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| JS rendering | Static HTML fetch only (v1) | Most corporate pages are server-rendered; headless is expensive and can be added later |
| Runtime | Convex Node actions | Leverages existing WorkPool infrastructure; no external services needed |
| Orchestration | WorkPool with time-budgeted batch actions | Proven pattern in codebase (indexing, generation); reliable at scale |
| Config depth | Sensible defaults + key overrides | Simple interface, good defaults for readability/turndown/unpdf |
| PDF conversion | Server-side in Convex Node action | Fits existing upload pattern; fine for typical support docs |
| Code location | Scraper + file processor in eval-lib; orchestration in backend | eval-lib stays stateless and testable; backend handles Convex-specific wiring |
| Frontier state | Convex tables (crawlJobs + crawlUrls) | Persistent, queryable, survives restarts, enables progress UI |
| Raw HTML storage | Not stored | HTML is available at source URL; only clean markdown persisted |
| HTML parsing | jsdom for everything (readability + link extraction) | Already a dependency for readability; eliminates need for cheerio |

### Explicitly Out of Scope (v1)

- Headless browser / JS-rendered pages — add when we encounter pages that need it
- robots.txt compliance — add later; v1 targets known corporate support pages
- Bulk import HTTP endpoint — not needed; scraper creates documents directly via Convex mutations
- Image extraction — RAG eval doesn't use images; always excluded from markdown

---

## Phase 1: Schema Changes + KB Queries

**Files**: `packages/backend/convex/schema.ts`, `packages/backend/convex/knowledgeBases.ts`

### 1a. Extend `knowledgeBases` table

Add optional fields after `metadata`:

```typescript
industry: v.optional(v.string()),       // "finance", "insurance", "healthcare", "telecom", "education", "government"
subIndustry: v.optional(v.string()),     // "retail-banking", "health-insurance", "wireless"
company: v.optional(v.string()),         // "JPMorgan Chase", "AT&T"
entityType: v.optional(v.string()),      // "company", "government-state", "government-county", "industry-aggregate"
sourceUrl: v.optional(v.string()),       // primary website URL
tags: v.optional(v.array(v.string())),   // ["fortune-500", "cx", "support"]
```

Add indexes:

```typescript
.index("by_org_industry", ["orgId", "industry"])
.index("by_org_company", ["orgId", "company"])
```

### 1b. Make `fileId` optional in `documents` table

Change `fileId: v.id("_storage")` → `fileId: v.optional(v.id("_storage"))`.

Scraped documents arrive as markdown strings with no file upload. The `content` field stores the full text. Existing documents with `fileId` are unaffected.

### 1c. Add source tracking to `documents` table

```typescript
sourceUrl: v.optional(v.string()),       // URL this document was scraped from
sourceType: v.optional(v.string()),      // "markdown" | "html" | "pdf" | "scraped"
```

Minimal tracking — just the URL and original format. No nested metadata objects.

### 1d. New `crawlJobs` table

```typescript
crawlJobs: defineTable({
  orgId: v.string(),
  kbId: v.id("knowledgeBases"),
  userId: v.id("users"),
  startUrl: v.string(),
  config: v.object({
    maxDepth: v.optional(v.number()),                 // default: 3
    maxPages: v.optional(v.number()),                 // default: 100
    includePaths: v.optional(v.array(v.string())),    // glob patterns: ["/help/*", "/support/*"]
    excludePaths: v.optional(v.array(v.string())),    // glob patterns: ["/login", "/admin/*"]
    allowSubdomains: v.optional(v.boolean()),          // default: false
    onlyMainContent: v.optional(v.boolean()),          // default: true
    delay: v.optional(v.number()),                     // ms between requests (rate limiting)
    concurrency: v.optional(v.number()),               // parallel requests per action, default: 3
  }),
  status: v.string(),                                 // "pending" | "running" | "completed" | "failed" | "cancelled"
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

### 1e. New `crawlUrls` table (URL frontier)

```typescript
crawlUrls: defineTable({
  crawlJobId: v.id("crawlJobs"),
  url: v.string(),
  normalizedUrl: v.string(),                          // for dedup (stripped fragments, trailing slash, sorted params)
  status: v.string(),                                  // "pending" | "scraping" | "done" | "failed" | "skipped"
  depth: v.number(),
  parentUrl: v.optional(v.string()),
  documentId: v.optional(v.id("documents")),           // links to created document when done
  error: v.optional(v.string()),
  retryCount: v.optional(v.number()),
  scrapedAt: v.optional(v.number()),
})
  .index("by_job_status", ["crawlJobId", "status"])
  .index("by_job_url", ["crawlJobId", "normalizedUrl"]),
```

### 1f. Update `create` mutation

Add optional args to `knowledgeBases.create`: `industry`, `subIndustry`, `company`, `entityType`, `sourceUrl`, `tags`. Pass through to `ctx.db.insert`.

### 1g. Add `listByIndustry` query

Uses `by_org_industry` index when industry filter is provided, falls back to `by_org` for unfiltered. Frontend handles any grouping/display logic client-side.

All schema changes are backward-compatible (optional fields, new tables, no migrations needed).

---

## Phase 2: File Processing Pipeline (eval-lib)

A reusable conversion engine that takes any raw file format and produces clean markdown.

**New directory**: `packages/eval-lib/src/file-processing/`

### Architecture

```
┌───────────────────────────────────────────────────┐
│                  FileProcessor                     │
│                                                    │
│  processFile(input, config) → ProcessedDocument    │
│                                                    │
│  ┌─────────────┐  ┌─────────────┐                │
│  │  HtmlToMd   │  │  PdfToMd    │                │
│  │             │  │             │                 │
│  │ readability │  │ unpdf       │  ← converters  │
│  │ + turndown  │  │             │                 │
│  │ + cleanup   │  │ + cleanup   │                 │
│  └─────────────┘  └─────────────┘                │
└───────────────────────────────────────────────────┘
```

### 2a. Core types and processor (`processor.ts`)

Types and main dispatcher live in the same file:

```typescript
interface FileProcessorConfig {
  onlyMainContent?: boolean;    // HTML: use readability to extract article (default: true)
  includeLinks?: boolean;       // keep hyperlinks in markdown (default: true)
}

interface ProcessedDocument {
  content: string;              // clean markdown
  title: string;                // extracted or inferred title
  metadata: {
    sourceFormat: "html" | "pdf" | "markdown";
    wordCount: number;
    links?: string[];           // extracted links (useful for crawl frontier)
  };
}

async function processFile(
  input:
    | { content: string; format: "html"; baseUrl?: string }
    | { buffer: Buffer; format: "pdf" }
    | { content: string; format: "markdown" },
  config?: FileProcessorConfig
): Promise<ProcessedDocument>;
```

Dispatches to the appropriate converter, then runs cleanup.

### 2b. HTML to Markdown (`html-to-markdown.ts`)

Pipeline:
1. Parse HTML with `jsdom`
2. Extract links from the full DOM (before readability strips them — needed for crawl frontier)
3. Extract main content with `@mozilla/readability` (when `onlyMainContent: true`)
4. Convert extracted HTML to markdown with `turndown`
5. Cleanup: normalize whitespace, collapse blank lines, strip HTML comments, trim

Libraries: `@mozilla/readability`, `jsdom`, `turndown`

Link extraction uses the same `jsdom` DOM instance — no need for a separate cheerio dependency.

### 2c. PDF to Markdown (`pdf-to-markdown.ts`)

Pipeline:
1. Extract text from PDF buffer using `unpdf`
2. Structure into markdown (headings from font size, paragraphs from spacing)
3. Same cleanup as HTML path

Library: `unpdf` (modern, TypeScript-native, async)

### 2d. Barrel Export (`index.ts`)

Exports `processFile`, `htmlToMarkdown`, `pdfToMarkdown`, and all types.

### New dependencies for eval-lib

```
@mozilla/readability   — main content extraction from HTML
jsdom                  — DOM implementation for readability (Node.js)
turndown               — HTML → Markdown conversion
unpdf                  — PDF text extraction
```

---

## Phase 3: Web Scraper + Seed Companies (eval-lib)

A single-page scraper that handles HTTP fetching and delegates to the file processing pipeline for conversion. Crawl orchestration (frontier, fan-out, progress) is the backend's job (Phase 4).

**New directory**: `packages/eval-lib/src/scraper/`

### 3a. Types (`types.ts`)

```typescript
interface ScrapedPage {
  url: string;
  markdown: string;                       // clean markdown content
  metadata: {
    title: string;
    sourceURL: string;
    description?: string;
    language?: string;
    statusCode: number;
    links: string[];                      // all discovered links on page
  };
}

interface ScrapeOptions {
  onlyMainContent?: boolean;              // default: true
  includeLinks?: boolean;                 // default: true
  timeout?: number;                       // per-page timeout ms (default: 30000)
  headers?: Record<string, string>;       // custom request headers
}

interface SeedEntity {
  name: string;
  industry: string;
  subIndustry: string;
  entityType: "company" | "government-state" | "government-county" | "industry-aggregate";
  sourceUrls: string[];
  tags: string[];
  notes?: string;
}
```

### 3b. Content Scraper (`scraper.ts`)

```typescript
class ContentScraper {
  constructor(config?: {
    userAgent?: string;
    defaultHeaders?: Record<string, string>;
  });

  /**
   * Scrape a single URL → returns clean markdown + metadata.
   * Uses got-scraping for HTTP fetch with browser-like headers.
   * Delegates to file processing pipeline for HTML → markdown conversion.
   */
  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapedPage>;
}
```

Implementation:
1. Fetch HTML via `got-scraping` (browser-like headers, anti-bot TLS fingerprints)
2. Call `htmlToMarkdown()` from file processing pipeline (extracts main content + links)
3. Return `ScrapedPage` with markdown + metadata including discovered links

### 3c. Link Extractor (`link-extractor.ts`)

```typescript
/**
 * Filter a list of discovered links against include/exclude patterns.
 * Pure function — no HTTP calls, no side effects.
 * Link discovery itself happens in htmlToMarkdown (reuses the jsdom DOM).
 */
function filterLinks(
  links: string[],
  baseUrl: string,
  config?: {
    includePaths?: string[];
    excludePaths?: string[];
    allowSubdomains?: boolean;
  }
): string[];

/**
 * Normalize URL for dedup: strip fragments, trailing slash,
 * sort query params, lowercase host.
 */
function normalizeUrl(url: string): string;
```

### 3d. Seed Companies (`seed-companies.ts`)

28 entities:

| Industry | Entities |
|----------|----------|
| Finance (3) | JPMorgan Chase, Bank of America, Wells Fargo |
| Insurance (3) | UnitedHealth Group, Elevance Health, MetLife |
| Healthcare (3) | CVS Health, HCA Healthcare, Humana |
| Telecom (3) | AT&T, Verizon, T-Mobile |
| Education (3) | University of California System, Coursera, Pearson |
| Government - States (8) | CA, TX, NY, FL, IL, OH, GA, WA |
| Government - Counties (5) | Los Angeles, Cook, Harris, Maricopa, King |

Helper functions: `getSeedIndustries()`, `getSeedEntitiesByIndustry(industry)`.

### 3e. Barrel Export (`index.ts`)

Exports `ContentScraper`, all types, `filterLinks`, `normalizeUrl`, seed company helpers.

### New dependencies for eval-lib

```
got-scraping           — HTTP client with browser-like headers and anti-bot TLS
```

---

## Phase 4: Crawl Orchestration (backend)

The backend manages crawl lifecycle using WorkPool + persistent frontier tables. The scraper itself (eval-lib) is stateless — all state lives in Convex tables.

### 4a. New WorkPool

**File**: `packages/backend/convex/convex.config.ts`

```typescript
app.use(workpool, { name: "scrapingPool" });
```

**File**: `packages/backend/convex/scraping.ts`

```typescript
const pool = new Workpool(components.scrapingPool, {
  maxParallelism: 3,                    // conservative: respect target site rate limits
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 5000,
    base: 2,
  },
});
```

### 4b. Crawl Job Lifecycle

```
User triggers "Import from URL"
        │
        ▼
  startCrawl mutation (scraping.ts)
  ├─ Create crawlJob record (status: "running")
  ├─ Insert seed URL(s) into crawlUrls (depth: 0, status: "pending")
  └─ Enqueue batchScrape action via WorkPool
        │
        ▼
  batchScrape action (scrapingActions.ts, "use node")
  ├─ TIME_BUDGET = 9 minutes (1 min buffer before 10-min Convex timeout)
  ├─ LOOP while time remaining > 30s:
  │   ├─ Check crawlJob status (exit if cancelled)
  │   ├─ Check maxPages limit (exit if reached)
  │   ├─ Query batch of pending URLs (10-20) from crawlUrls
  │   ├─ Mark batch as "scraping" via mutation
  │   ├─ For each URL (3-5 concurrent via Promise.allSettled):
  │   │   ├─ Respect delay config (rate limiting)
  │   │   ├─ Call eval-lib ContentScraper.scrape(url, options)
  │   │   ├─ Filter discovered links via eval-lib filterLinks()
  │   │   ├─ Persist via mutation:
  │   │   │   ├─ Create document in documents table (sourceType: "scraped")
  │   │   │   ├─ Mark crawlUrl as "done", set documentId
  │   │   │   └─ Insert newly discovered URLs (dedup via by_job_url index)
  │   │   └─ On failure: mark crawlUrl as "failed", increment retryCount
  │   └─ Update crawlJob stats via mutation
  └─ END LOOP
        │
        ▼
  onComplete callback (scraping.ts)
  ├─ Reset failed URLs with retryCount < max → "pending"
  ├─ If pending URLs remain and maxPages not reached → enqueue another batchScrape
  └─ Otherwise → mark crawlJob "completed" with final stats
```

### 4c. New Convex Files

| File | Runtime | Purpose |
|------|---------|---------|
| `convex/scraping.ts` | V8 | WorkPool setup, `startCrawl`/`cancelCrawl` mutations, crawl queries, `onComplete` callback |
| `convex/scrapingActions.ts` | Node (`"use node"`) | `batchScrape` action — time-budgeted scraping loop calling eval-lib |
| `convex/scrapingMutations.ts` | V8 | Internal mutations: `markUrlsScraping`, `persistScrapedPage`, `insertDiscoveredUrls`, `updateCrawlJobStats`, `markUrlFailed`; internal query: `getPendingUrls` |

### 4d. Reliability Guarantees

- **Checkpoint per URL**: Each scraped page is persisted immediately via mutation. If the action crashes mid-batch, completed pages are not lost.
- **Retry with backoff**: WorkPool retries failed actions. Individual URL failures tracked in `crawlUrls.retryCount`.
- **Dedup**: `crawlUrls.by_job_url` index on `normalizedUrl` prevents re-discovering the same URL.
- **Never redo work**: The action queries only `status: "pending"` URLs. Completed URLs are never re-processed.
- **Cancellation**: `cancelCrawl` mutation sets job status to "cancelled". The batchScrape action checks at the start of each loop iteration and exits early.
- **Scale**: A 100K page crawl runs as sequential batch actions (each scraping hundreds of pages in 9 minutes), fully reliable, checkpointed per URL.

### 4e. Parallelism Model

| Level | Parallelism | Controlled by |
|-------|-------------|---------------|
| Within a batch action | 3-5 concurrent HTTP requests | `Promise.allSettled` + `concurrency` config |
| Across actions for same job | 1 (sequential continuation) | WorkPool enqueue pattern |
| Across different crawl jobs | Up to `maxParallelism` (3) | WorkPool `scrapingPool` |

### 4f. File Upload Enhancement

The existing `FileUploader` + `documents.ts` get extended:

- Accept `.pdf` and `.html` files (in addition to `.md`/`.txt`)
- After upload to Convex storage, enqueue a file processing action:
  1. Read raw file from storage
  2. Call eval-lib `processFile()` (HTML→MD or PDF→MD)
  3. Update document record with clean markdown content and `sourceType`
- Original file remains in storage as `fileId`

---

## Phase 5: Frontend — Minimal Updates

**Files**: `packages/frontend/src/components/KBSelector.tsx`, `packages/frontend/src/components/FileUploader.tsx`

### 5a. Industry filter

Add a `<select>` above the KB dropdown: "All Industries", "finance", "insurance", etc. Uses `api.knowledgeBases.listByIndustry` query with the selected industry as filter.

### 5b. Enhanced create form

Collapsible "Advanced" section when creating a new KB:
- Industry dropdown (known industries)
- Company name text input
- Entity type dropdown

### 5c. Import from URL

New section below the KB document list:
- Text input for URL
- "Start Crawl" button (calls `startCrawl` mutation)
- Progress display: "Scraping... 45/120 pages" (reactive query on `crawlJobs`)
- Cancel button

### 5d. Enhanced FileUploader

- Accept `.pdf` and `.html` files
- Show conversion progress for non-markdown files
- Display `sourceType` badge next to document titles

---

## Implementation Order

```
Phase 1 (schema + KB queries) ──┬──> Phase 4 (crawl orchestration) ──> Phase 5 (frontend)
                                │
Phase 2 (file processing) ──────┤
                                │
Phase 3 (scraper + seeds) ──────┘
```

Recommended sequence: **1 → 2 → 3 → 4 → 5**

Phases 2 and 3 can be parallelized (both eval-lib only, no backend dependency beyond Phase 1 schema).

---

## Files Summary

| Action | File | Package |
|--------|------|---------|
| Modify | `convex/schema.ts` | backend |
| Modify | `convex/knowledgeBases.ts` | backend |
| Modify | `convex/convex.config.ts` | backend |
| Modify | `src/index.ts` | eval-lib |
| Modify | `src/components/KBSelector.tsx` | frontend |
| Modify | `src/components/FileUploader.tsx` | frontend |
| Create | `src/file-processing/processor.ts` | eval-lib |
| Create | `src/file-processing/html-to-markdown.ts` | eval-lib |
| Create | `src/file-processing/pdf-to-markdown.ts` | eval-lib |
| Create | `src/file-processing/index.ts` | eval-lib |
| Create | `src/scraper/types.ts` | eval-lib |
| Create | `src/scraper/scraper.ts` | eval-lib |
| Create | `src/scraper/link-extractor.ts` | eval-lib |
| Create | `src/scraper/seed-companies.ts` | eval-lib |
| Create | `src/scraper/index.ts` | eval-lib |
| Create | `convex/scraping.ts` | backend |
| Create | `convex/scrapingActions.ts` | backend |
| Create | `convex/scrapingMutations.ts` | backend |

### New Dependencies

**eval-lib** (`packages/eval-lib/package.json`):
```
@mozilla/readability    — main content extraction from HTML
jsdom                   — DOM implementation for readability in Node.js
turndown                — HTML → Markdown conversion
unpdf                   — PDF text extraction (modern, TypeScript-native)
got-scraping            — HTTP client with browser-like headers/TLS fingerprints
```

**backend** (`packages/backend/package.json`):
No new dependencies. Uses eval-lib's scraper via workspace dependency.

---

## Verification

1. **Schema**: `pnpm -C packages/backend npx convex dev --once` — deploys schema, confirms no validation errors
2. **Eval-lib build**: `pnpm build` — confirms file processor and scraper compile and export correctly
3. **Unit tests**: `pnpm test` — new tests for file processing (HTML→MD, PDF→MD) and scraper (link filtering, URL normalization)
4. **Crawl test**: Trigger a small crawl (5-10 pages) from the frontend and verify documents appear in the KB
5. **TypeScript**: `pnpm typecheck` and `pnpm typecheck:backend` — no type errors
6. **Existing tests**: `pnpm test` — all existing tests still pass (no breaking changes)
