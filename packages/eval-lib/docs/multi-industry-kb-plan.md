# Plan: Multi-Industry Knowledge Base Infrastructure

## Context

The RAG evaluation system currently has a flat, untagged KB model — KBs are just a name + description with no industry classification, hierarchy, or bulk import capability. To benchmark retrievers across diverse real-world data (Fortune 500 companies across finance, insurance, healthcare, telecom, education, and government), we need:

1. Structured KB metadata (industry, company, entity type, tags)
2. A scraper interface abstraction (implementation deferred to a separate change)
3. A bulk import HTTP endpoint for external tools/scrapers to push documents into KBs
4. Updated queries and frontend for filtering/browsing KBs by industry
5. A curated seed company list to define the initial target set

The scraper itself is **out of scope** — we only define the interface contract here.

---

## Phase 1: Schema Changes

**File**: `packages/backend/convex/schema.ts`

### 1a. Extend `knowledgeBases` table (lines 22-29)

Add optional fields after `metadata`:
- `industry: v.optional(v.string())` — e.g. "finance", "insurance", "healthcare", "telecom", "education", "government"
- `subIndustry: v.optional(v.string())` — e.g. "retail-banking", "health-insurance", "wireless"
- `company: v.optional(v.string())` — e.g. "JPMorgan Chase", "AT&T"
- `entityType: v.optional(v.string())` — "company", "government-state", "government-county", "industry-aggregate"
- `sourceUrl: v.optional(v.string())` — primary website URL
- `tags: v.optional(v.array(v.string()))` — freeform tags: ["fortune-500", "cx", "support"]

Add indexes:
- `.index("by_org_industry", ["orgId", "industry"])` — efficient filtering by industry
- `.index("by_org_company", ["orgId", "company"])` — dedup lookup during bulk import

### 1b. Make `fileId` optional in `documents` table (line 38)

Change `fileId: v.id("_storage")` → `fileId: v.optional(v.id("_storage"))`

Reason: Bulk-imported documents come as raw markdown strings (no file upload), so they have no storage reference. The `content` field already stores the full text. Existing documents with `fileId` are unaffected.

### 1c. Add `sourceUrl` to `documents` table

Add `sourceUrl: v.optional(v.string())` — tracks which URL a document was scraped from.

All changes are backward-compatible (optional fields only, no migrations needed).

---

## Phase 2: Scraper Interface + Firecrawl Stub (eval-lib)

**New files**:
- `packages/eval-lib/src/scrapers/scraper.interface.ts`
- `packages/eval-lib/src/scrapers/firecrawl.ts`
- `packages/eval-lib/src/scrapers/index.ts`

### 2a. `scraper.interface.ts` — Core types

```typescript
interface ScrapedPage {
  url: string;
  title: string;
  content: string;  // clean markdown
  metadata: Record<string, unknown>;
}

interface ScrapeTarget {
  url: string;
  maxPages?: number;
  includePaths?: string[];   // glob patterns, e.g. "/help/*", "/support/*"
  excludePaths?: string[];
  options?: Record<string, unknown>;
}

interface ContentScraper {
  scrapePage(url: string): Promise<ScrapedPage>;
  crawlSite(target: ScrapeTarget): AsyncIterable<ScrapedPage>;
}
```

### 2b. `firecrawl.ts` — Stub adapter

A `FirecrawlScraper` class that implements `ContentScraper` with stub methods that throw "not implemented" errors with guidance on installing `@mendable/firecrawl-js`. Accepts a `{ apiKey, baseUrl? }` config.

### 2c. Export from `packages/eval-lib/src/index.ts`

Add scraper types and classes to the library's public API.

---

## Phase 3: Convex HTTP Endpoint for Bulk Import

**New files**:
- `packages/backend/convex/http.ts` — HTTP router
- `packages/backend/convex/bulkImport.ts` — HTTP action handler
- `packages/backend/convex/bulkImportMutations.ts` — Internal mutations

### 3a. `http.ts` — Convex HTTP router

Routes `POST /api/bulk-import` to the bulk import handler. This file must export `default httpRouter()`.

### 3b. `bulkImport.ts` — HTTP action

Auth via `x-api-key` header checked against `BULK_IMPORT_API_KEY` env var (set in Convex dashboard).

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
2. Call `findOrCreateKb` internal mutation (idempotent by company + industry)
3. Batch-insert documents (50 per mutation call to respect transaction limits)
4. Return `{ kbId, documentsInserted }`

### 3c. `bulkImportMutations.ts` — Internal mutations

- `findOrCreateKb`: Looks up existing KB by `(orgId, company, industry)` via the `by_org_company` index. Creates new KB if not found. Looks up user via `by_clerk_id` index.
- `insertDocumentBatch`: Inserts up to 50 documents at a time. Sets `fileId` to `undefined` (allowed after Phase 1b schema change). Uses title as `docId`.

**Note**: HTTP actions run in V8 runtime (NOT Node). No `"use node"` directive. All logic delegated to internal mutations via `ctx.runMutation`.

### 3d. Update `packages/backend/.env.example`

Add `BULK_IMPORT_API_KEY=` with a comment explaining its purpose.

---

## Phase 4: Updated KB CRUD with Filtering

**File**: `packages/backend/convex/knowledgeBases.ts`

### 4a. Update `create` mutation

Add optional args: `industry`, `subIndustry`, `company`, `entityType`, `sourceUrl`, `tags`. Pass them through to `ctx.db.insert`.

### 4b. Add `listByIndustry` query

Uses `by_org_industry` index when industry filter is provided, falls back to `by_org` for unfiltered.

### 4c. Add `listGroupedByIndustry` query

Fetches all KBs for the org, groups them into a `Record<string, KB[]>` by industry (KBs without industry go under `"uncategorized"`). Used by the frontend for grouped display.

---

## Phase 5: Seed Company Config

**New file**: `packages/eval-lib/src/scrapers/seed-companies.ts`

A `SEED_ENTITIES` array of `SeedEntity` objects, each with: `name`, `industry`, `subIndustry`, `entityType`, `sourceUrls`, `tags`, optional `notes`.

**Target**: 28 entities total:
- **Finance** (3): JPMorgan Chase, Bank of America, Wells Fargo
- **Insurance** (3): UnitedHealth Group, Elevance Health, MetLife
- **Healthcare** (3): CVS Health, HCA Healthcare, Humana
- **Telecom** (3): AT&T, Verizon, T-Mobile
- **Education** (3): University of California System, Coursera, Pearson
- **Government - States** (8): CA, TX, NY, FL, IL, OH, GA, WA (diverse regions/sizes)
- **Government - Counties** (5): Los Angeles, Cook, Harris, Maricopa, King

Helper functions: `getSeedIndustries()`, `getSeedEntitiesByIndustry(industry)`.

Exported from `scrapers/index.ts` and `src/index.ts`.

---

## Phase 6: Frontend — Enhanced KBSelector

**File**: `packages/frontend/src/components/KBSelector.tsx`

### Changes:

1. **Switch data source**: Use `api.knowledgeBases.listGroupedByIndustry` (from Phase 4c) instead of `api.knowledgeBases.list`

2. **Add industry filter**: A `<select>` above the KB dropdown with options: "All Industries", "finance", "insurance", etc. Filters which KBs appear in the dropdown.

3. **Grouped KB dropdown**: Use `<optgroup>` elements to visually group KBs by industry within the dropdown.

4. **Show metadata badges**: Display industry and company as small badges/tags next to KB names in the dropdown options.

5. **Enhanced create form**: When creating a new KB, show optional fields for industry (dropdown of known industries), company name, and entity type. Keep it collapsible so it doesn't clutter the simple case.

---

## Implementation Order

```
Phase 1 (schema) ──┬──> Phase 3 (HTTP endpoint) ──> Phase 5 (seed config)
                   │
                   └──> Phase 4 (backend queries) ──> Phase 6 (frontend)

Phase 2 (scraper interface) — independent, can be parallel with any phase
```

Recommended sequence: 1 → 2 → 4 → 3 → 5 → 6

---

## Files Summary

| Action | File |
|--------|------|
| Modify | `packages/backend/convex/schema.ts` |
| Modify | `packages/backend/convex/knowledgeBases.ts` |
| Modify | `packages/backend/.env.example` |
| Modify | `packages/eval-lib/src/index.ts` |
| Modify | `packages/frontend/src/components/KBSelector.tsx` |
| Create | `packages/eval-lib/src/scrapers/scraper.interface.ts` |
| Create | `packages/eval-lib/src/scrapers/firecrawl.ts` |
| Create | `packages/eval-lib/src/scrapers/index.ts` |
| Create | `packages/eval-lib/src/scrapers/seed-companies.ts` |
| Create | `packages/backend/convex/http.ts` |
| Create | `packages/backend/convex/bulkImport.ts` |
| Create | `packages/backend/convex/bulkImportMutations.ts` |

---

## Verification

1. **Schema**: `pnpm -C packages/backend npx convex dev --once` — deploys schema, confirms no validation errors
2. **Eval-lib build**: `pnpm build` — confirms scraper types compile and export correctly
3. **HTTP endpoint**: Use `curl` to POST a test payload to the bulk import endpoint and verify KB + documents are created
4. **Frontend**: `pnpm dev` — verify KBSelector shows industry filter and grouped display
5. **TypeScript**: `pnpm typecheck` and `pnpm typecheck:backend` — no type errors
6. **Tests**: `pnpm test` — existing tests still pass (no breaking changes)
