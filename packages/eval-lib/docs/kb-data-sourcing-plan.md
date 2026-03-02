# KB Data Sourcing Plan

> Successor to `multi-industry-kb-plan.md`. Covers everything from that plan plus the in-house web scraper, file processing pipeline, and crawl orchestration.

## Context

The RAG evaluation system needs diverse, real-world knowledge bases spanning multiple industries (finance, insurance, healthcare, telecom, education, government). Today, KBs are flat (name + description) and documents can only be uploaded as `.md`/`.txt` files from the browser.

This plan introduces:

1. **Structured KB metadata** — industry, company, entity type, tags
2. **File processing pipeline** — converts HTML, PDF, and raw markdown into clean markdown
3. **In-house web scraper** — Firecrawl-compatible interface for scraping/crawling websites
4. **Crawl orchestration** — reliable, time-budgeted batch scraping via Convex WorkPool
5. **Bulk import HTTP endpoint** — for external tools to push documents into KBs
6. **Seed company list** — 28 entities across 6 industries for initial benchmarking
7. **Minimal frontend updates** — industry filter, URL import, PDF/HTML upload support

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| JS rendering | Hybrid: static fetch default, headless opt-in | Most corporate pages are server-rendered; headless is expensive |
| Runtime | Convex Node actions + external fallback for headless | Leverages existing WorkPool; external service only when needed |
| Orchestration | WorkPool fan-out with time-budgeted batch actions | Proven pattern in codebase (indexing, generation); reliable at scale |
| Config depth | Sensible defaults + key overrides | Simple interface, good defaults for readability/turndown/unpdf |
| PDF conversion | Server-side in Convex Node action | Fits existing upload pattern; fine for typical support docs |
| Code location | Full scraper + file processor in eval-lib | Maximum reusability; backend is thin orchestration layer |
| Frontier state | Convex tables (crawlJobs + crawlUrls) | Persistent, queryable, survives restarts, enables progress UI |
| Raw HTML storage | Not stored | HTML is available at source URL; only clean markdown persisted |
| Frontend scope | Minimal | Industry metadata fields, import button, progress display |

---

## Phase 1: Schema Changes

**File**: `packages/backend/convex/schema.ts`

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

Reason: Scraped documents arrive as markdown strings with no file upload. The `content` field stores the full text. Existing documents with `fileId` are unaffected.

### 1c. Add source tracking to `documents` table

```typescript
sourceUrl: v.optional(v.string()),                    // URL this document was scraped from
sourceType: v.optional(v.string()),                   // "markdown" | "html" | "pdf" | "scraped"
rawFileId: v.optional(v.id("_storage")),              // raw file before conversion (PDF, user-uploaded HTML)
conversionMetadata: v.optional(v.object({
  sourceFormat: v.string(),                           // original format
  convertedAt: v.number(),                            // timestamp
  method: v.string(),                                 // "readability+turndown", "unpdf", "cleanup"
  wordCount: v.optional(v.number()),
})),
```

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
    includeLinks: v.optional(v.boolean()),             // default: true
    includeImages: v.optional(v.boolean()),            // default: false
    delay: v.optional(v.number()),                     // ms between requests (rate limiting)
    respectRobotsTxt: v.optional(v.boolean()),         // default: true
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

All changes are backward-compatible (optional fields, new tables, no migrations needed).

---

## Phase 2: File Processing Pipeline (eval-lib)

A reusable conversion engine that takes any raw file format and produces clean markdown.

**New directory**: `packages/eval-lib/src/file-processing/`

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     FileProcessor                        │
│                                                          │
│  processFile(input, config) → ProcessedDocument          │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  HtmlToMd    │  │  PdfToMd     │  │  MdCleanup   │  │
│  │              │  │              │  │              │   │
│  │  readability │  │  unpdf /     │  │  frontmatter │   │
│  │  + turndown  │  │  pdf-parse   │  │  link fix    │   │
│  │              │  │              │  │  whitespace  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2a. Types (`types.ts`)

```typescript
interface FileProcessorConfig {
  onlyMainContent?: boolean;    // HTML: use readability to extract article (default: true)
  includeImages?: boolean;      // keep image references in markdown (default: false)
  includeLinks?: boolean;       // keep hyperlinks in markdown (default: true)
  cleanupMarkdown?: boolean;    // run MD cleanup pass (default: true)
}

interface ProcessedDocument {
  content: string;              // clean markdown
  title: string;                // extracted or inferred title
  metadata: {
    sourceFormat: "html" | "pdf" | "markdown";
    wordCount: number;
    links?: string[];           // extracted links (useful for crawling)
    images?: string[];
  };
}
```

### 2b. HTML to Markdown (`html-to-markdown.ts`)

Pipeline:
1. Parse HTML with `jsdom`
2. Extract main content with `@mozilla/readability` (when `onlyMainContent: true`)
3. Convert to markdown with `turndown`
4. Optionally strip images/links based on config
5. Run markdown cleanup

Libraries: `@mozilla/readability`, `jsdom`, `turndown`

### 2c. PDF to Markdown (`pdf-to-markdown.ts`)

Pipeline:
1. Extract text from PDF buffer using `unpdf`
2. Structure into markdown (headings from font size, paragraphs from spacing)
3. Run markdown cleanup

Library: `unpdf` (modern, TypeScript-native, async)

### 2d. Markdown Cleanup (`markdown-cleanup.ts`)

- Normalize whitespace (collapse multiple blank lines)
- Remove/strip frontmatter if unwanted
- Fix relative links (resolve against base URL when provided)
- Strip HTML comments
- Trim trailing whitespace

### 2e. Main Processor (`processor.ts`)

```typescript
function processFile(
  input:
    | { content: string; format: "html"; baseUrl?: string }
    | { buffer: Buffer; format: "pdf" }
    | { content: string; format: "markdown" },
  config?: FileProcessorConfig
): Promise<ProcessedDocument>;
```

Dispatches to the appropriate converter based on `format`, then runs cleanup.

### 2f. Barrel Export (`index.ts`)

Exports all types, `processFile`, and individual converters (`htmlToMarkdown`, `pdfToMarkdown`, `cleanupMarkdown`) for direct use.

### New dependencies for eval-lib

```
@mozilla/readability   — main content extraction from HTML
jsdom                  — DOM implementation for readability (Node.js)
turndown               — HTML → Markdown conversion
unpdf                  — PDF text extraction
```

---

## Phase 3: Web Scraper Module (eval-lib)

A Firecrawl-compatible scraper SDK that handles single-page scraping and link extraction. Crawl orchestration is delegated to the Convex backend (Phase 5).

**New directory**: `packages/eval-lib/src/scraper/`

### 3a. Types (`types.ts`)

```typescript
// ─── Scrape Types (Firecrawl-compatible) ───

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
  formats?: ("markdown")[];               // currently only markdown supported
  onlyMainContent?: boolean;              // default: true
  includeLinks?: boolean;                 // default: true
  includeImages?: boolean;                // default: false
  timeout?: number;                       // per-page timeout ms (default: 30000)
  headers?: Record<string, string>;       // custom request headers
  useHeadless?: boolean;                  // default: false (triggers HeadlessBrowserRequired error)
}

// ─── Crawl Config (used by backend orchestrator) ───

interface CrawlConfig {
  url: string;                            // start URL
  maxDepth?: number;                      // default: 3
  maxPages?: number;                      // default: 100
  includePaths?: string[];                // glob patterns: ["/help/*", "/support/*"]
  excludePaths?: string[];                // glob patterns: ["/login", "/admin/*"]
  allowSubdomains?: boolean;              // default: false
  scrapeOptions?: ScrapeOptions;          // applied to each page
  delay?: number;                         // ms between requests (rate limiting)
  respectRobotsTxt?: boolean;             // default: true
  concurrency?: number;                   // parallel fetches, default: 3
}

// ─── Seed Entity ───

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
1. Fetch HTML via `got-scraping` (browser-like headers, anti-bot TLS)
2. Call `htmlToMarkdown()` from file processing pipeline
3. Call `extractLinks()` for link discovery
4. Return `ScrapedPage` with markdown + metadata

When `useHeadless: true`, throws `HeadlessBrowserRequired` error — the backend catches this and delegates to an external service (out of scope for initial version).

### 3c. Link Extractor (`link-extractor.ts`)

```typescript
/**
 * Extract and filter links from HTML content.
 * Pure function — no HTTP calls, no side effects.
 */
function extractLinks(
  html: string,
  baseUrl: string,
  config?: {
    includePaths?: string[];
    excludePaths?: string[];
    allowSubdomains?: boolean;
  }
): string[];
```

Uses `cheerio` to parse `<a href>` tags, resolves relative URLs, applies glob-pattern filters, respects subdomain settings.

### 3d. URL Utilities (`url-utils.ts`)

```typescript
/**
 * Normalize URL for dedup: strip fragments, trailing slash, sort query params, lowercase host.
 */
function normalizeUrl(url: string): string;

/**
 * Parse and check robots.txt for a given URL.
 */
function isAllowedByRobotsTxt(robotsTxt: string, url: string, userAgent: string): boolean;

/**
 * Fetch and cache robots.txt for a domain.
 */
async function fetchRobotsTxt(domain: string): Promise<string | null>;
```

Uses `robots-parser` npm package for robots.txt compliance.

### 3e. Seed Companies (`seed-companies.ts`)

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

### 3f. Barrel Export (`index.ts`)

Exports `ContentScraper`, all types, `extractLinks`, `normalizeUrl`, seed company helpers.

### New dependencies for eval-lib

```
got-scraping           — HTTP client with browser-like headers and anti-bot features
cheerio                — fast HTML parsing for link extraction
robots-parser          — robots.txt parsing and compliance checking
```

Note: `got-scraping` is the HTTP client used by Crawlee internally. It provides browser-like TLS fingerprints and headers out of the box, which is critical for avoiding blocks on corporate websites.

---

## Phase 4: KB CRUD + Bulk Import (backend)

### 4a. Update `create` mutation

**File**: `packages/backend/convex/knowledgeBases.ts`

Add optional args: `industry`, `subIndustry`, `company`, `entityType`, `sourceUrl`, `tags`. Pass them through to `ctx.db.insert`.

### 4b. Add `listByIndustry` query

Uses `by_org_industry` index when industry filter is provided, falls back to `by_org` for unfiltered.

### 4c. Add `listGroupedByIndustry` query

Fetches all KBs for the org, groups into `Record<string, KB[]>` by industry. KBs without industry go under `"uncategorized"`.

### 4d. HTTP Bulk Import Endpoint

**New files**:
- `packages/backend/convex/http.ts` — HTTP router, routes `POST /api/bulk-import`
- `packages/backend/convex/bulkImport.ts` — HTTP action handler
- `packages/backend/convex/bulkImportMutations.ts` — internal mutations

Auth: `x-api-key` header checked against `BULK_IMPORT_API_KEY` env var.

Request body:

```json
{
  "orgId": "org_xxx",
  "userId": "user_xxx",
  "kb": {
    "name": "JPMorgan Chase - Support",
    "industry": "finance",
    "subIndustry": "retail-banking",
    "company": "JPMorgan Chase",
    "entityType": "company",
    "sourceUrl": "https://www.chase.com",
    "tags": ["fortune-500", "cx"]
  },
  "documents": [
    { "title": "FAQ - Checking Accounts", "content": "# FAQ...", "sourceUrl": "https://..." }
  ]
}
```

Logic:
1. Validate API key
2. `findOrCreateKb` — idempotent by `(orgId, company, industry)` via `by_org_company` index
3. Batch-insert documents (50 per mutation call to respect transaction limits)
4. Return `{ kbId, documentsInserted }`

**Note**: HTTP actions run in V8 runtime (no `"use node"`). All logic delegated to internal mutations via `ctx.runMutation`.

### 4e. Update `.env.example`

Add `BULK_IMPORT_API_KEY=` with comment.

---

## Phase 5: Crawl Orchestration (backend)

The backend manages crawl lifecycle using WorkPool + persistent frontier tables.

### 5a. New WorkPool

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

### 5b. Crawl Job Lifecycle

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
  │   ├─ Query batch of pending URLs (10-20) from crawlUrls via internal query
  │   ├─ Mark batch as "scraping" via internal mutation
  │   ├─ For each URL (3-5 concurrent via Promise.allSettled):
  │   │   ├─ Check robots.txt (cached per domain)
  │   │   ├─ Respect delay config (rate limiting)
  │   │   ├─ Call eval-lib ContentScraper.scrape(url, options)
  │   │   ├─ Call eval-lib extractLinks(html, baseUrl, filters)
  │   │   ├─ Persist via internal mutation:
  │   │   │   ├─ Create document in documents table (sourceType: "scraped")
  │   │   │   ├─ Mark crawlUrl as "done", set documentId
  │   │   │   └─ Insert newly discovered URLs (dedup via by_job_url index)
  │   │   └─ On failure: mark crawlUrl as "failed", increment retryCount
  │   └─ Update crawlJob stats via internal mutation
  └─ END LOOP
        │
        ▼
  onComplete callback (scraping.ts)
  ├─ Check: any remaining pending URLs in crawlUrls?
  ├─ Check: maxPages limit reached?
  ├─ Reset failed URLs with retryCount < max → "pending"
  ├─ If more work → enqueue another batchScrape action
  └─ If done → mark crawlJob "completed" with final stats
```

### 5c. New Convex Files

| File | Runtime | Purpose |
|------|---------|---------|
| `convex/scraping.ts` | V8 | WorkPool setup, `startCrawl` mutation, `cancelCrawl` mutation, crawl queries, onComplete callback |
| `convex/scrapingActions.ts` | Node (`"use node"`) | `batchScrape` action — time-budgeted scraping loop calling eval-lib |
| `convex/scrapingMutations.ts` | V8 | Internal mutations: `markUrlsScraping`, `persistScrapedPage`, `insertDiscoveredUrls`, `updateCrawlJobStats`, `markUrlFailed`, `getPendingUrls` (internal query) |

### 5d. Reliability Guarantees

- **Checkpoint per URL**: Each scraped page is persisted immediately via mutation. If the action crashes mid-batch, completed pages are not lost.
- **Retry with backoff**: WorkPool retries failed actions. Individual URL failures are tracked in `crawlUrls.retryCount`.
- **Dedup**: `crawlUrls.by_job_url` index on `normalizedUrl` prevents re-discovering the same URL.
- **Never redo work**: The action queries only `status: "pending"` URLs. Completed URLs are never re-processed.
- **Cancellation**: `cancelCrawl` mutation sets job status to "cancelled". The batchScrape action checks job status at the start of each loop iteration and exits early.
- **Scale**: A 100K page crawl runs as ~100+ sequential batch actions (each scraping ~500-1000 pages in 9 minutes), fully reliable, checkpointed per URL.

### 5e. Parallelism Model

| Level | Parallelism | Controlled by |
|-------|-------------|---------------|
| Within a batch action | 3-5 concurrent HTTP requests | `Promise.allSettled` + `concurrency` config |
| Across actions for same job | 1 (sequential continuation) | WorkPool enqueue pattern |
| Across different crawl jobs | Up to `maxParallelism` (3) | WorkPool `scrapingPool` |

### 5f. File Upload Enhancement

The existing `FileUploader` + `documents.ts` get extended:

- Accept `.pdf` and `.html` files (in addition to `.md`/`.txt`)
- After upload to Convex storage, enqueue a file processing action:
  1. Read raw file from storage
  2. Call eval-lib `processFile()` (HTML→MD or PDF→MD)
  3. Update document record with clean markdown content + `conversionMetadata`
- Raw file remains in storage as `rawFileId` (for PDF and user-uploaded files only)

---

## Phase 6: Seed Company Config (eval-lib)

**File**: `packages/eval-lib/src/scraper/seed-companies.ts`

```typescript
const SEED_ENTITIES: SeedEntity[] = [
  // Finance (3)
  {
    name: "JPMorgan Chase",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: ["https://www.chase.com/digital/resources/privacy-security/questions"],
    tags: ["fortune-500", "cx"],
  },
  // ... Bank of America, Wells Fargo

  // Insurance (3)
  // ... UnitedHealth Group, Elevance Health, MetLife

  // Healthcare (3)
  // ... CVS Health, HCA Healthcare, Humana

  // Telecom (3)
  // ... AT&T, Verizon, T-Mobile

  // Education (3)
  // ... UC System, Coursera, Pearson

  // Government - States (8)
  // ... CA, TX, NY, FL, IL, OH, GA, WA

  // Government - Counties (5)
  // ... Los Angeles, Cook, Harris, Maricopa, King
];

function getSeedIndustries(): string[];
function getSeedEntitiesByIndustry(industry: string): SeedEntity[];
```

Exported from `scraper/index.ts` and `src/index.ts`.

---

## Phase 7: Frontend — Minimal Updates

**File**: `packages/frontend/src/components/KBSelector.tsx`

### 7a. Industry filter

Add a `<select>` above the KB dropdown: "All Industries", "finance", "insurance", etc. Uses `api.knowledgeBases.listGroupedByIndustry` query.

### 7b. Enhanced create form

Collapsible "Advanced" section when creating a new KB:
- Industry dropdown (known industries)
- Company name text input
- Entity type dropdown

### 7c. Import from URL

New section below the KB document list:
- Text input for URL
- "Start Crawl" button (calls `startCrawl` mutation)
- Progress display: "Scraping... 45/120 pages" (reactive query on `crawlJobs`)
- Cancel button

### 7d. Enhanced FileUploader

- Accept `.pdf` and `.html` files
- Show conversion progress for non-markdown files
- Display `sourceType` badge next to document titles

---

## Implementation Order

```
Phase 1 (schema) ──┬──> Phase 4 (KB queries + bulk import)
                   │
                   └──> Phase 5 (crawl orchestration) ──> Phase 7 (frontend)
                                    │
Phase 2 (file processing) ─────────┤
                                    │
Phase 3 (scraper module) ──────────┘

Phase 6 (seed companies) — independent, parallel with any phase
```

Recommended sequence: **1 → 2 → 3 → 4 → 5 → 6 → 7**

Phases 2, 3, and 6 can be parallelized since they're eval-lib only (no backend dependency beyond Phase 1 schema).

---

## Files Summary

| Action | File | Package |
|--------|------|---------|
| Modify | `convex/schema.ts` | backend |
| Modify | `convex/knowledgeBases.ts` | backend |
| Modify | `convex/convex.config.ts` | backend |
| Modify | `.env.example` | backend |
| Modify | `src/index.ts` | eval-lib |
| Modify | `src/components/KBSelector.tsx` | frontend |
| Modify | `src/components/FileUploader.tsx` | frontend |
| Create | `src/file-processing/types.ts` | eval-lib |
| Create | `src/file-processing/html-to-markdown.ts` | eval-lib |
| Create | `src/file-processing/pdf-to-markdown.ts` | eval-lib |
| Create | `src/file-processing/markdown-cleanup.ts` | eval-lib |
| Create | `src/file-processing/processor.ts` | eval-lib |
| Create | `src/file-processing/index.ts` | eval-lib |
| Create | `src/scraper/types.ts` | eval-lib |
| Create | `src/scraper/scraper.ts` | eval-lib |
| Create | `src/scraper/link-extractor.ts` | eval-lib |
| Create | `src/scraper/url-utils.ts` | eval-lib |
| Create | `src/scraper/seed-companies.ts` | eval-lib |
| Create | `src/scraper/index.ts` | eval-lib |
| Create | `convex/http.ts` | backend |
| Create | `convex/bulkImport.ts` | backend |
| Create | `convex/bulkImportMutations.ts` | backend |
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
got-scraping            — HTTP client with browser-like headers/TLS
cheerio                 — fast HTML parsing for link extraction
robots-parser           — robots.txt parsing and compliance
```

**backend** (`packages/backend/package.json`):
No new dependencies. Uses eval-lib's scraper via workspace dependency.

---

## Verification

1. **Schema**: `pnpm -C packages/backend npx convex dev --once` — deploys schema, confirms no validation errors
2. **Eval-lib build**: `pnpm build` — confirms file processor and scraper types compile and export correctly
3. **Unit tests**: `pnpm test` — new tests for file processing pipeline (HTML→MD, PDF→MD, cleanup) and scraper (link extraction, URL normalization)
4. **Integration test**: Use `curl` to POST a test payload to the bulk import endpoint and verify KB + documents are created
5. **Crawl test**: Trigger a small crawl (5-10 pages) from the frontend and verify documents appear in the KB
6. **TypeScript**: `pnpm typecheck` and `pnpm typecheck:backend` — no type errors
7. **Existing tests**: `pnpm test` — all existing tests still pass (no breaking changes)
