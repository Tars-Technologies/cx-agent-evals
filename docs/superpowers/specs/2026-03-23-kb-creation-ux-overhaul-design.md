# KB Creation & Import UX Overhaul

**Date:** 2026-03-23
**Status:** Draft
**Origin:** Co-founder feedback (Ish) on internal tool usability

## Problem Statement

The current KB creation and URL import flow has several UX issues identified during internal testing:

1. **KB Creation Modal**: The "Source URL" field is confusing — users expect it to trigger scraping, but it's just metadata. No sensible defaults for entity type or industry.
2. **Import from URL**: Currently a subtle toggle link (`text-xs text-text-dim`) that's easy to miss. Opens inline with just a URL input and "Go" button — no configuration options exposed.
3. **Content Extraction**: Mozilla Readability's heuristic filtering strips valid main content when Tailwind CSS's `overflow-hidden` class triggers its `/hidden/` negative regex pattern, causing entire card grids and accordion sections to be removed.
4. **No localStorage persistence**: Users re-enter the same company details and import settings every time.

## Scope

Four tightly coupled changes spanning eval-lib, frontend, and backend defaults:

- **A. KB Creation Modal** — field renaming, defaults, industry customization, localStorage
- **B. Import from URL Modal** — new modal with full scraper config, localStorage
- **C. Content Extraction Fix** — replace Readability with CSS-selector-based cleaning
- **D. Document Viewer** — default to rendered markdown (existing toggle preserved)

Out of scope: dual-view (full vs clean markdown), ground truth span editing, retriever/experiment UX changes.

---

## A. KB Creation Modal

### Current State

File: `packages/frontend/src/components/CreateKBModal.tsx`

Fields: `name` (required), `industry` (dropdown, 6 options), `entityType` (dropdown, 4 options), `company` (text), `sourceUrl` (text). All optional fields default to empty. No localStorage persistence.

**Note:** The `INDUSTRIES` constant is duplicated in both `CreateKBModal.tsx` and `packages/frontend/src/app/kb/page.tsx` (used for the industry filter dropdown). Both must be updated together.

### Changes

#### A1. Extract shared constants

Create `packages/frontend/src/lib/constants.ts` with the shared `INDUSTRIES` and `ENTITY_TYPES` arrays. Import from both `CreateKBModal.tsx` and `kb/page.tsx` to prevent drift.

#### A2. Rename "Source URL" to "Company URL"

- Label change: `Source URL` → `Company URL`
- Placeholder change: `https://acme.com/support` → `https://acme.com`
- This field identifies which company/entity the KB belongs to. It is also used to pre-populate the Import from URL modal (see B2).

#### A3. Industry field: add "Other" + custom value

- Add `"other"` to the `INDUSTRIES` array in the new shared constants file.
- When "Other" is selected, show a text input below the dropdown for a custom industry value.
- The custom value is stored in the `industry` field as-is (no schema change needed — field is already `v.optional(v.string())`).
- The KB page industry filter dropdown also gets the "Other" option, allowing users to filter for KBs with industry "other" or custom values.

Updated `INDUSTRIES`:
```typescript
const INDUSTRIES = [
  "finance",
  "insurance",
  "healthcare",
  "telecom",
  "education",
  "government",
  "other",
] as const;
```

#### A4. Default values

- `entityType`: pre-select `"company"` (instead of empty)
- `industry`: pre-select `"other"` (instead of empty)

These defaults reduce friction for the most common case (evaluating a company's KB).

#### A5. localStorage persistence

**Storage key:** `rag-eval:kb-create-config`

**Stored fields:** `{ version, company, companyUrl, industry, customIndustry, entityType }`

**Behavior:**
- On modal open: read localStorage via try/catch (silent fallback to defaults if storage unavailable, e.g. private browsing). If `version` is missing or doesn't match current version, discard stored data and use defaults.
- On successful KB creation: write current values to localStorage (wrapped in try/catch).
- Show a subtle indicator when values are pre-populated from a previous session: a small text label below the form title — `"Previously used values"` in `text-text-dim` — that disappears once any field is manually changed.
- The `name` field is never pre-populated (always blank for a new KB).

**Storage format:**
```typescript
interface KBCreateConfig {
  version: 1;
  company: string;
  companyUrl: string;
  industry: string;
  customIndustry: string; // only relevant when industry === "other"
  entityType: string;
}
```

---

## B. Import from URL Modal

### Current State

File: `packages/frontend/src/app/kb/page.tsx`

Currently the `showImportUrl` toggle button shows/hides an inline URL input + "Go" button. No configuration options exposed. The `startCrawl` mutation is called with only `kbId` and `startUrl` — all config uses server defaults (`maxPages: 100`, `maxDepth: 3`, `onlyMainContent: true`).

### Changes

#### B1. Replace toggle link with primary button

Replace the current subtle link with a primary accent button:
```tsx
<button className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap">
  Import from URL
</button>
```

This button sits alongside the `FileUploader` component in the Upload + Import section of the document panel.

#### B2. Import from URL modal

Clicking the button opens a modal (new component: `ImportUrlModal.tsx`) with:

**Primary fields (always visible):**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| Start URL | text input | Pre-populated from KB's `sourceUrl` (company URL). If KB has no `sourceUrl`, the field is left empty. | User can change it |
| Max Pages | number input | `200` | Min: 1, Max: 1000 |
| Include URL Patterns | comma-separated text input | Empty | Glob patterns, e.g. `/docs/**`. Plain text input — no chip/tag UI. Users type patterns separated by commas. |
| Exclude URL Patterns | comma-separated text input | Empty | Glob patterns, e.g. `/blog/**`. Same as above. |

**Advanced fields (collapsed by default, behind "Advanced" toggle):**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| Max Depth | number input | `3` | How many link-hops deep to crawl |
| Allow Subdomains | toggle/checkbox | `false` | e.g. `help.tars.com` when crawling `tars.com` |
| Concurrency | number input | `3` | Parallel HTTP requests per batch action (1-10). This is separate from the WorkPool parallelism. |
| Delay | number input | `0` | Rate limit delay between requests in ms |

**Modal footer:**
- "Cancel" button (secondary)
- "Start Import" button (primary, accent green)

**On "Start Import":**
1. Call `startCrawl` mutation with all config values:
   ```typescript
   await startCrawl({
     kbId: selectedKbId,
     startUrl: url.trim(),
     config: {
       maxPages,
       maxDepth,
       includePaths: includePaths.length ? includePaths : undefined,
       excludePaths: excludePaths.length ? excludePaths : undefined,
       allowSubdomains,
       concurrency,
       delay,
     },
   });
   ```
2. Close the modal
3. Set `crawlJobId` state to show progress in the document panel (existing crawl progress UI)

#### B3. Backend default change

In `packages/backend/convex/scraping/orchestration.ts`, change the `maxPages` default:

```typescript
// Before
maxPages: userConfig.maxPages ?? 100,

// After
maxPages: userConfig.maxPages ?? 200,
```

The `onlyMainContent` default remains `true`. The semantics of this flag change from "use Readability" to "apply CSS-selector boilerplate cleaning" (see Section C). Since CSS-selector cleaning is the desired default behavior for all crawls, keeping the default as `true` is correct.

#### B4. localStorage persistence for import config

**Storage key:** `rag-eval:import-url-config`

**Stored fields:** `{ version, maxPages, includePaths, excludePaths, maxDepth, allowSubdomains, concurrency, delay }`

**Behavior:**
- On modal open: read localStorage via try/catch (silent fallback to defaults). If `version` is missing or doesn't match, discard and use defaults.
- Pre-populate config fields only (NOT the Start URL — that comes from the KB's company URL or is entered fresh).
- On successful import start: write current config values to localStorage (wrapped in try/catch).
- No "previously used" indicator needed here — config fields having defaults is expected.

**Storage format:**
```typescript
interface ImportUrlConfig {
  version: 1;
  maxPages: number;
  includePaths: string[];
  excludePaths: string[];
  maxDepth: number;
  allowSubdomains: boolean;
  concurrency: number;
  delay: number;
}
```

---

## C. Content Extraction Fix

### Root Cause Analysis

**Problem:** Mozilla Readability strips valid main content from pages that use Tailwind CSS.

**Mechanism:** Readability's `_getClassWeight()` method tests element class names against a negative regex:
```
/-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|...
```

Tailwind's `overflow-hidden` utility class contains the substring `hidden`, triggering a **-25 class weight**. In `_cleanConditionally`, elements with `weight + contentScore < 0` are removed immediately.

**Impact:**
- Card grids with `overflow-hidden` are stripped (e.g., "Core platform components" section on `docs.hellotars.com/platform-fundamentals/how-tars-works`)
- Accordion/details elements with `overflow-hidden` are stripped (e.g., FAQ section on `docs.hellotars.com`)
- Any Tailwind-styled content using `overflow-hidden`, `overflow-x-hidden`, etc.

**Verified:** Content IS present in server-rendered HTML. It IS inside the article container Readability selects. The loss occurs specifically at the Readability cleanup phase, not at Turndown conversion.

### Solution: Replace Readability with CSS-selector-based cleaning

Remove Mozilla Readability from the content extraction pipeline. Replace it with explicit CSS selector removal of known boilerplate elements.

**File:** `packages/eval-lib/src/file-processing/html-to-markdown.ts`

**New approach:**

```typescript
// Instead of Readability:
// 1. Remove known boilerplate elements by CSS selector
// 2. Pass the cleaned HTML body to Turndown

const BOILERPLATE_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
  ".cookie-banner",
  ".cookie-consent",
  "#cookie-banner",
  "#cookie-consent",
  ".gdpr",
  "#gdpr",
  "script",
  "style",
  "noscript",
  "iframe",
];
```

**Note on SVGs:** `<svg>` elements are NOT included in the boilerplate selectors. Many documentation sites embed SVGs containing meaningful content (architecture diagrams, annotated illustrations with `<text>` elements). Turndown can extract text from SVGs. Blanket removal would silently drop content. If SVG noise becomes an issue on specific sites, a more targeted approach (e.g., removing only SVGs without `<text>` or `<title>` children) can be added later.

**Implementation:**

1. Parse HTML with linkedom (unchanged).
2. For each selector in `BOILERPLATE_SELECTORS`, query matching elements and call `element.remove()`.
3. Pass the cleaned `doc.body.innerHTML` to Turndown (unchanged).
4. Apply existing `cleanupMarkdown()` post-processing (unchanged).

**Key changes:**
- Remove `@mozilla/readability` import and usage.
- The `onlyMainContent` option retains its name and default (`true`). Its implementation changes from "use Readability to extract article" to "apply CSS-selector boilerplate cleaning." When `false`, raw body HTML is passed through (same behavior as before).
- The `Readability` constructor and `.parse()` call are fully removed.

**What this preserves:**
- All card grids, accordions, and custom-styled content
- Semantic HTML content in `<main>`, `<article>`, `<section>`, `<div>` elements
- Content with Tailwind utility classes
- SVG diagrams and illustrations

**What this removes:**
- Navigation bars (`<nav>`, `[role='navigation']`)
- Page headers/footers (`<header>`, `<footer>`)
- Sidebars (`<aside>`, `[role='complementary']`)
- Cookie/GDPR banners (common class/id patterns)
- Non-content elements (`<script>`, `<style>`, `<noscript>`, `<iframe>`)

**Dependency cleanup:**
- Remove `@mozilla/readability` from `packages/eval-lib/package.json`
- Remove `@mozilla/readability` from `packages/backend/convex.json` `externalPackages` array (it is listed there)
- The `linkedom` and `turndown` dependencies remain

### Test Plan for Content Extraction

**Unit tests** (add to `packages/eval-lib/tests/`):

1. HTML with `<nav>` and `<footer>` wrapping boilerplate → verify nav/footer content is removed, main content preserved
2. HTML with `overflow-hidden` class on content divs → verify content is preserved (regression test for the Readability bug)
3. HTML with `<details>` accordion elements → verify accordion content is preserved
4. HTML with cookie banner div (`.cookie-banner`) → verify banner is removed
5. HTML with `<script>` and `<style>` tags → verify they are removed
6. HTML with `onlyMainContent: false` → verify no cleaning occurs, raw body passed through

**Integration tests** (manual verification):

7. Scrape `docs.hellotars.com/platform-fundamentals/how-tars-works` — verify 6 card grid content is present in markdown output
8. Scrape `docs.hellotars.com/` — verify FAQ accordion content ("Common beginner mistakes") is present
9. Scrape a page with heavy navigation (e.g., documentation site with sidebar) — verify nav/sidebar is NOT in markdown
10. Run existing eval-lib test suite (`pnpm test`) to check for regressions

---

## D. Document Viewer Default

### Current State

File: `packages/frontend/src/app/kb/page.tsx`

The `docViewMode` state already defaults to `"rendered"` and has a raw/rendered toggle. No change needed — the current behavior matches the requirement.

**Confirmation:** The raw/rendered toggle is preserved as-is.

---

## Component Structure

### New Files

| File | Purpose |
|------|---------|
| `packages/frontend/src/components/ImportUrlModal.tsx` | Modal with scraper config, replaces inline URL input |
| `packages/frontend/src/lib/constants.ts` | Shared `INDUSTRIES` and `ENTITY_TYPES` arrays |

### Modified Files

| File | Changes |
|------|---------|
| `packages/frontend/src/components/CreateKBModal.tsx` | Rename field, add "other" industry + custom input, defaults, localStorage |
| `packages/frontend/src/app/kb/page.tsx` | Replace toggle link with button, wire up `ImportUrlModal`, remove inline crawl UI, import shared constants |
| `packages/eval-lib/src/file-processing/html-to-markdown.ts` | Replace Readability with CSS-selector cleaning |
| `packages/backend/convex/scraping/orchestration.ts` | Update `maxPages` default to 200 |
| `packages/eval-lib/package.json` | Remove `@mozilla/readability` dependency |
| `packages/backend/convex.json` | Remove `@mozilla/readability` from `externalPackages` |

---

## localStorage Keys Summary

| Key | Scope | Fields | Pre-populated From |
|-----|-------|--------|--------------------|
| `rag-eval:kb-create-config` | KB creation | version, company, companyUrl, industry, customIndustry, entityType | Last KB created |
| `rag-eval:import-url-config` | URL import | version, maxPages, includePaths, excludePaths, maxDepth, allowSubdomains, concurrency, delay | Last import started |

All localStorage reads/writes are wrapped in try/catch with silent fallback to defaults (handles private browsing, storage full, etc.). Each stored config includes a `version` field; if the version is missing or doesn't match the current version, stored data is discarded and defaults are used.

---

## Data Flow

```
KB Creation:
  User fills modal → localStorage.set(kb-config) → createKb mutation → KB record created
                                                                          ↓
                                                                    sourceUrl stored on KB

URL Import:
  User clicks "Import from URL" → Modal opens
    ↓
  Start URL pre-populated from KB.sourceUrl (empty if KB has no sourceUrl)
  Config pre-populated from localStorage(import-config) or defaults
    ↓
  User clicks "Start Import" → localStorage.set(import-config)
    ↓
  startCrawl mutation (with full config object) → crawlJob created → batchScrape actions
    ↓
  Modal closes, progress shown in document panel
    ↓
  Each scraped page: HTML → CSS-selector boilerplate removal → Turndown → markdown → document record

Document Viewing:
  User clicks document in sidebar → rendered markdown shown (default)
  Toggle to "raw" to see source markdown
```

---

## Migration & Backwards Compatibility

- **No schema changes** — all modifications use existing fields and types.
- **No data migration** — existing documents are unaffected. Only newly scraped documents will use the CSS-selector cleaning instead of Readability.
- **Backend default change** (`maxPages: 200`) only affects new crawl jobs. Existing completed jobs are not re-processed.
- **localStorage** is additive — first-time users see sensible defaults; returning users get pre-populated values.
- **Readability removal** is safe because the `onlyMainContent` flag behavior is preserved (true = clean, false = raw) — just the cleaning strategy changes from heuristic to explicit selectors.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| CSS-selector cleaning misses boilerplate on some sites | Medium | The selector list covers semantic HTML and common patterns. Unusual sites may include some nav content. This is acceptable — over-inclusion is better than over-exclusion. |
| CSS-selector cleaning removes legitimate `<nav>` used for content | Low | Rare pattern. Could add a `data-content` attribute whitelist if needed later. |
| localStorage unavailable (private browsing) | Low | All reads/writes wrapped in try/catch with silent fallback to defaults. |
| localStorage schema changes in future releases | Low | Version field enables safe discard of incompatible stored data. |
| `overflow-hidden` fix may not cover all Tailwind false positives | N/A | Fully resolved by removing Readability entirely. No regex matching involved. |
