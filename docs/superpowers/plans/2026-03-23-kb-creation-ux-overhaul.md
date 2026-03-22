# KB Creation & Import UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix KB creation UX (field renaming, defaults, localStorage), replace inline URL import with a configurable modal, and fix content extraction by replacing Mozilla Readability with CSS-selector-based cleaning.

**Architecture:** Four changes in one pass — shared constants extraction, CreateKBModal enhancements, new ImportUrlModal component, and htmlToMarkdown pipeline swap. No schema changes, no data migration. Frontend changes are React components with Convex hooks. Content extraction change is in eval-lib's file-processing module.

**Tech Stack:** TypeScript, React (Next.js 16), Convex, Tailwind CSS v4, vitest, linkedom, turndown

**Spec:** `docs/superpowers/specs/2026-03-23-kb-creation-ux-overhaul-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/frontend/src/lib/constants.ts` | Shared `INDUSTRIES` and `ENTITY_TYPES` arrays, localStorage helper functions |
| `packages/frontend/src/components/ImportUrlModal.tsx` | Modal with scraper config fields, localStorage persistence, calls `startCrawl` mutation |

### Modified Files

| File | Changes |
|------|---------|
| `packages/eval-lib/src/file-processing/html-to-markdown.ts` | Replace Readability with `BOILERPLATE_SELECTORS` CSS-selector cleaning |
| `packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts` | Add 6 unit tests for CSS-selector cleaning |
| `packages/eval-lib/package.json` | Remove `@mozilla/readability` dependency |
| `packages/backend/convex.json` | Remove `@mozilla/readability` from `externalPackages` |
| `packages/backend/convex/scraping/orchestration.ts` | Change `maxPages` default from 100 to 200 |
| `packages/frontend/src/components/CreateKBModal.tsx` | Rename field, add "other" industry + custom input, defaults, localStorage |
| `packages/frontend/src/app/kb/page.tsx` | Replace inline import with button + ImportUrlModal, import shared constants |

---

## Task 1: Replace Readability with CSS-selector cleaning (eval-lib)

**Files:**
- Modify: `packages/eval-lib/src/file-processing/html-to-markdown.ts`
- Test: `packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts`

This is the foundational change — the content extraction fix. Done first because it's in eval-lib (no frontend/backend dependencies) and has the clearest test surface.

- [ ] **Step 1: Write failing tests for CSS-selector cleaning**

Add these tests to the existing test file after the current tests:

```typescript
it("removes nav, header, footer, aside when onlyMainContent is true", async () => {
  const html = `<html><body>
    <nav><ul><li>Home</li><li>About</li></ul></nav>
    <header><div>Site Header Banner</div></header>
    <main><h1>Main Content</h1><p>Important text here</p></main>
    <aside><p>Sidebar widget</p></aside>
    <footer><p>Copyright 2024</p></footer>
  </body></html>`;
  const result = await htmlToMarkdown(html, { onlyMainContent: true });
  expect(result.content).toContain("Main Content");
  expect(result.content).toContain("Important text here");
  expect(result.content).not.toContain("Home");
  expect(result.content).not.toContain("Site Header Banner");
  expect(result.content).not.toContain("Sidebar widget");
  expect(result.content).not.toContain("Copyright 2024");
});

it("preserves content with overflow-hidden class (Tailwind regression)", async () => {
  const html = `<html><body>
    <div class="card-group">
      <div class="card overflow-hidden rounded-2xl">
        <h3>AI Agent</h3>
        <p>Handles customer conversations</p>
      </div>
      <div class="card overflow-hidden rounded-2xl">
        <h3>Knowledge Base</h3>
        <p>Stores training data</p>
      </div>
    </div>
  </body></html>`;
  const result = await htmlToMarkdown(html, { onlyMainContent: true });
  expect(result.content).toContain("AI Agent");
  expect(result.content).toContain("Knowledge Base");
  expect(result.content).toContain("Handles customer conversations");
});

it("preserves details/summary accordion elements", async () => {
  const html = `<html><body>
    <div class="accordion-group overflow-hidden">
      <details class="accordion overflow-hidden">
        <summary>Why aren't my Gambits executing?</summary>
        <p>Check your gambit conditions and triggers.</p>
      </details>
      <details class="accordion overflow-hidden">
        <summary>How many Gambits should I use?</summary>
        <p>Start with 3-5 gambits per flow.</p>
      </details>
    </div>
  </body></html>`;
  const result = await htmlToMarkdown(html, { onlyMainContent: true });
  expect(result.content).toContain("Gambits executing");
  expect(result.content).toContain("gambit conditions");
  expect(result.content).toContain("How many Gambits");
});

it("removes cookie banner elements", async () => {
  const html = `<html><body>
    <div class="cookie-banner"><p>We use cookies</p><button>Accept</button></div>
    <main><h1>Page Content</h1></main>
    <div id="gdpr"><p>GDPR notice</p></div>
  </body></html>`;
  const result = await htmlToMarkdown(html, { onlyMainContent: true });
  expect(result.content).toContain("Page Content");
  expect(result.content).not.toContain("We use cookies");
  expect(result.content).not.toContain("GDPR notice");
});

it("removes script, style, noscript, and iframe elements", async () => {
  const html = `<html><body>
    <script>console.log("track")</script>
    <style>.nav { color: red }</style>
    <noscript>Enable JavaScript</noscript>
    <iframe src="https://ads.example.com"></iframe>
    <main><p>Real content</p></main>
  </body></html>`;
  const result = await htmlToMarkdown(html, { onlyMainContent: true });
  expect(result.content).toContain("Real content");
  expect(result.content).not.toContain("track");
  expect(result.content).not.toContain("color: red");
  expect(result.content).not.toContain("Enable JavaScript");
});

it("returns full unmodified content when onlyMainContent is false", async () => {
  const html = `<html><body>
    <nav>Navigation</nav>
    <main><h1>Main</h1></main>
    <footer>Footer</footer>
  </body></html>`;
  const result = await htmlToMarkdown(html, { onlyMainContent: false });
  expect(result.content).toContain("Navigation");
  expect(result.content).toContain("Main");
  expect(result.content).toContain("Footer");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/eval-lib && npx vitest run tests/unit/file-processing/html-to-markdown.test.ts`

Expected: The "overflow-hidden" and "accordion" tests will fail (Readability strips content). The "removes nav/header/footer" test may pass partially due to Readability. The "onlyMainContent false" test already passes (existing test covers this).

- [ ] **Step 3: Implement CSS-selector cleaning in htmlToMarkdown**

Replace the Readability block in `packages/eval-lib/src/file-processing/html-to-markdown.ts`. The full new file content:

```typescript
export interface HtmlToMarkdownOptions {
  onlyMainContent?: boolean;
  baseUrl?: string;
}

export interface HtmlToMarkdownResult {
  content: string;
  title: string;
  links: string[];
}

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

export async function htmlToMarkdown(
  html: string,
  options?: HtmlToMarkdownOptions,
): Promise<HtmlToMarkdownResult> {
  const linkedomMod = await import("linkedom");
  const parseHTML: (html: string) => { document: any } =
    (linkedomMod as any).parseHTML ?? (linkedomMod as any).default?.parseHTML;

  const turndownMod = await import("turndown");
  const TurndownService = (turndownMod as any).default ?? turndownMod;

  const onlyMainContent = options?.onlyMainContent ?? true;
  const baseUrl = options?.baseUrl;
  const { document: doc } = parseHTML(html) as { document: any };

  const links = extractLinks(doc, baseUrl);
  let title: string = doc.querySelector("title")?.textContent?.trim() || "";
  const h1Title: string = doc.querySelector("h1")?.textContent?.trim() || "";
  let htmlForConversion: string;

  if (onlyMainContent) {
    for (const selector of BOILERPLATE_SELECTORS) {
      const elements = doc.querySelectorAll(selector);
      for (const el of elements) {
        el.remove();
      }
    }
    htmlForConversion = doc.body?.innerHTML || html;
  } else {
    htmlForConversion = doc.body?.innerHTML || html;
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  let markdown = turndown.turndown(htmlForConversion);
  markdown = cleanupMarkdown(markdown);

  // Title priority: <title> tag > original h1 > first markdown heading
  if (!title) {
    title = h1Title;
  }
  if (!title) {
    const headingMatch = markdown.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch) title = headingMatch[1];
  }

  return { content: markdown, title, links };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLinks(doc: any, baseUrl?: string): string[] {
  const anchors = doc.querySelectorAll("a[href]");
  const links: string[] = [];
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:"))
      continue;
    try {
      const resolved = baseUrl ? new URL(href, baseUrl).href : href;
      links.push(resolved);
    } catch {
      /* skip malformed URLs */
    }
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

- [ ] **Step 4: Run tests to verify they all pass**

Run: `cd packages/eval-lib && npx vitest run tests/unit/file-processing/html-to-markdown.test.ts`

Expected: All 10 tests pass (4 existing + 6 new).

- [ ] **Step 5: Run full eval-lib test suite for regressions**

Run: `cd packages/eval-lib && npx vitest run`

Expected: All tests pass. If any tests relied on Readability-specific behavior (e.g., article title extraction from Readability's `article.title`), they may need adjustment — the title now falls through to h1/heading extraction only.

- [ ] **Step 6: Commit**

```bash
git add packages/eval-lib/src/file-processing/html-to-markdown.ts packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts
git commit -m "fix(eval-lib): replace Readability with CSS-selector cleaning

Readability's negative regex matches Tailwind's overflow-hidden class,
stripping card grids and accordion content. Replace with explicit
boilerplate selector removal (nav, header, footer, aside, scripts, etc).
Preserves all main content including Tailwind-styled elements."
```

---

## Task 2: Remove @mozilla/readability dependency

**Files:**
- Modify: `packages/eval-lib/package.json`
- Modify: `packages/backend/convex.json`

- [ ] **Step 1: Remove from eval-lib package.json**

In `packages/eval-lib/package.json`, remove the line:
```
"@mozilla/readability": "^0.6.0",
```

- [ ] **Step 2: Remove from convex.json externalPackages**

In `packages/backend/convex.json`, change line 6 from:
```json
"@mozilla/readability", "linkedom", "turndown", "unpdf",
```
to:
```json
"linkedom", "turndown", "unpdf",
```

- [ ] **Step 3: Reinstall dependencies**

Run: `cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/neo && pnpm install`

Expected: Lockfile updates, no errors. `@mozilla/readability` removed from node_modules.

- [ ] **Step 4: Verify build still works**

Run: `pnpm build`

Expected: eval-lib builds successfully. No imports of `@mozilla/readability` remain.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/package.json packages/backend/convex.json pnpm-lock.yaml
git commit -m "chore: remove @mozilla/readability dependency

No longer needed after switching to CSS-selector-based cleaning."
```

---

## Task 3: Update backend maxPages default

**Files:**
- Modify: `packages/backend/convex/scraping/orchestration.ts`

- [ ] **Step 1: Change maxPages default**

In `packages/backend/convex/scraping/orchestration.ts`, change line 59:

```typescript
// Before
maxPages: userConfig.maxPages ?? 100,

// After
maxPages: userConfig.maxPages ?? 200,
```

- [ ] **Step 2: Verify backend typechecks**

Run: `pnpm typecheck:backend`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/scraping/orchestration.ts
git commit -m "feat(backend): increase default maxPages from 100 to 200"
```

---

## Task 4: Extract shared constants

**Files:**
- Create: `packages/frontend/src/lib/constants.ts`
- Modify: `packages/frontend/src/components/CreateKBModal.tsx`
- Modify: `packages/frontend/src/app/kb/page.tsx`

- [ ] **Step 1: Create the shared constants file**

Create `packages/frontend/src/lib/constants.ts`:

```typescript
export const INDUSTRIES = [
  "finance",
  "insurance",
  "healthcare",
  "telecom",
  "education",
  "government",
  "other",
] as const;

export const ENTITY_TYPES = [
  "company",
  "government-state",
  "government-county",
  "industry-aggregate",
] as const;

// ── localStorage helpers ──

const KB_CREATE_CONFIG_KEY = "rag-eval:kb-create-config";
const IMPORT_URL_CONFIG_KEY = "rag-eval:import-url-config";
const CURRENT_VERSION = 1;

export interface KBCreateConfig {
  version: typeof CURRENT_VERSION;
  company: string;
  companyUrl: string;
  industry: string;
  customIndustry: string;
  entityType: string;
}

export interface ImportUrlConfig {
  version: typeof CURRENT_VERSION;
  maxPages: number;
  includePaths: string[];
  excludePaths: string[];
  maxDepth: number;
  allowSubdomains: boolean;
  concurrency: number;
  delay: number;
}

export function loadKBCreateConfig(): KBCreateConfig | null {
  try {
    const raw = localStorage.getItem(KB_CREATE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== CURRENT_VERSION) return null;
    return parsed as KBCreateConfig;
  } catch {
    return null;
  }
}

export function saveKBCreateConfig(config: Omit<KBCreateConfig, "version">): void {
  try {
    localStorage.setItem(
      KB_CREATE_CONFIG_KEY,
      JSON.stringify({ ...config, version: CURRENT_VERSION }),
    );
  } catch {
    // silent fallback — private browsing or storage full
  }
}

export function loadImportUrlConfig(): ImportUrlConfig | null {
  try {
    const raw = localStorage.getItem(IMPORT_URL_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== CURRENT_VERSION) return null;
    return parsed as ImportUrlConfig;
  } catch {
    return null;
  }
}

export function saveImportUrlConfig(config: Omit<ImportUrlConfig, "version">): void {
  try {
    localStorage.setItem(
      IMPORT_URL_CONFIG_KEY,
      JSON.stringify({ ...config, version: CURRENT_VERSION }),
    );
  } catch {
    // silent fallback
  }
}
```

- [ ] **Step 2: Update CreateKBModal.tsx to import shared constants**

In `packages/frontend/src/components/CreateKBModal.tsx`:

Remove the local `INDUSTRIES` and `ENTITY_TYPES` constants (lines 8-22). Add import at top:

```typescript
import { INDUSTRIES, ENTITY_TYPES } from "@/lib/constants";
```

- [ ] **Step 3: Update kb/page.tsx to import shared constants**

In `packages/frontend/src/app/kb/page.tsx`:

Remove the local `INDUSTRIES` constant (lines 13-15). Add to imports:

```typescript
import { INDUSTRIES } from "@/lib/constants";
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd packages/frontend && npx next build`

Expected: Build succeeds. No duplicate constant warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/constants.ts packages/frontend/src/components/CreateKBModal.tsx packages/frontend/src/app/kb/page.tsx
git commit -m "refactor(frontend): extract shared INDUSTRIES and ENTITY_TYPES constants

Adds localStorage helper functions for KB creation and import config
persistence. Prevents constant drift between CreateKBModal and KB page."
```

---

## Task 5: Update CreateKBModal with new UX

**Files:**
- Modify: `packages/frontend/src/components/CreateKBModal.tsx`

- [ ] **Step 1: Rewrite CreateKBModal with all enhancements**

Replace the entire content of `packages/frontend/src/components/CreateKBModal.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import {
  INDUSTRIES,
  ENTITY_TYPES,
  loadKBCreateConfig,
  saveKBCreateConfig,
} from "@/lib/constants";

interface CreateKBModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (kbId: Id<"knowledgeBases">) => void;
}

export function CreateKBModal({ open, onClose, onCreated }: CreateKBModalProps) {
  const createKb = useMutation(api.crud.knowledgeBases.create);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState<string>("other");
  const [customIndustry, setCustomIndustry] = useState("");
  const [entityType, setEntityType] = useState<string>("company");
  const [company, setCompany] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [showPreviousHint, setShowPreviousHint] = useState(false);

  // Pre-populate from localStorage when modal opens
  useEffect(() => {
    if (!open) return;
    const saved = loadKBCreateConfig();
    if (saved) {
      setCompany(saved.company);
      setCompanyUrl(saved.companyUrl);
      setIndustry(saved.industry || "other");
      setCustomIndustry(saved.customIndustry);
      setEntityType(saved.entityType || "company");
      setShowPreviousHint(true);
    } else {
      setIndustry("other");
      setEntityType("company");
      setShowPreviousHint(false);
    }
    setName("");
    setCreating(false);
  }, [open]);

  if (!open) return null;

  function handleFieldChange() {
    setShowPreviousHint(false);
  }

  const resolvedIndustry =
    industry === "other" && customIndustry.trim()
      ? customIndustry.trim()
      : industry === "other"
        ? undefined
        : industry;

  async function handleCreate() {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createKb({
        name: name.trim(),
        ...(resolvedIndustry && { industry: resolvedIndustry }),
        ...(entityType && { entityType }),
        ...(company.trim() && { company: company.trim() }),
        ...(companyUrl.trim() && { sourceUrl: companyUrl.trim() }),
      });
      saveKBCreateConfig({
        company: company.trim(),
        companyUrl: companyUrl.trim(),
        industry,
        customIndustry: customIndustry.trim(),
        entityType,
      });
      onCreated(id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-text">Create Knowledge Base</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {showPreviousHint && (
          <p className="text-[10px] text-text-dim -mt-2">Previously used values</p>
        )}

        <div className="border-t border-border" />

        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corp Support KB"
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wide">Industry</label>
            <select
              value={industry}
              onChange={(e) => {
                setIndustry(e.target.value);
                handleFieldChange();
              }}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text-dim focus:border-accent outline-none"
            >
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind.charAt(0).toUpperCase() + ind.slice(1)}
                </option>
              ))}
            </select>
            {industry === "other" && (
              <input
                type="text"
                value={customIndustry}
                onChange={(e) => {
                  setCustomIndustry(e.target.value);
                  handleFieldChange();
                }}
                placeholder="Enter custom industry..."
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none mt-1"
              />
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wide">Entity Type</label>
            <select
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                handleFieldChange();
              }}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text-dim focus:border-accent outline-none"
            >
              {ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">Company</label>
          <input
            type="text"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              handleFieldChange();
            }}
            placeholder="e.g. Acme Inc"
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">Company URL</label>
          <input
            type="text"
            value={companyUrl}
            onChange={(e) => {
              setCompanyUrl(e.target.value);
              handleFieldChange();
            }}
            placeholder="https://acme.com"
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
          />
        </div>

        <div className="border-t border-border" />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-dim hover:text-text border border-border rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="px-4 py-2 text-sm bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd packages/frontend && npx next build`

Expected: Build succeeds.

- [ ] **Step 3: Manual test**

Start dev server (`pnpm dev`), navigate to KB page, click "+ Create KB":
- Verify industry defaults to "Other" with custom input visible
- Verify entity type defaults to "company"
- Verify label says "Company URL" not "Source URL"
- Create a KB, then reopen the modal — verify values pre-populated with "Previously used values" hint
- Change a field — verify hint disappears

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/CreateKBModal.tsx
git commit -m "feat(frontend): enhance CreateKBModal with defaults, custom industry, localStorage

- Rename Source URL to Company URL
- Default industry to 'other' with custom value input
- Default entity type to 'company'
- Persist config to localStorage, pre-populate on next open
- Show 'Previously used values' hint when pre-populated"
```

---

## Task 6: Create ImportUrlModal component

**Files:**
- Create: `packages/frontend/src/components/ImportUrlModal.tsx`

- [ ] **Step 1: Create ImportUrlModal**

Create `packages/frontend/src/components/ImportUrlModal.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { loadImportUrlConfig, saveImportUrlConfig } from "@/lib/constants";

interface ImportUrlModalProps {
  open: boolean;
  onClose: () => void;
  kbId: Id<"knowledgeBases">;
  defaultUrl?: string; // pre-populated from KB's sourceUrl
  onStarted: (jobId: Id<"crawlJobs">) => void;
}

export function ImportUrlModal({
  open,
  onClose,
  kbId,
  defaultUrl,
  onStarted,
}: ImportUrlModalProps) {
  const startCrawl = useMutation(api.scraping.orchestration.startCrawl);

  // Primary fields
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(200);
  const [includePaths, setIncludePaths] = useState("");
  const [excludePaths, setExcludePaths] = useState("");

  // Advanced fields
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxDepth, setMaxDepth] = useState(3);
  const [allowSubdomains, setAllowSubdomains] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const [delay, setDelay] = useState(0);

  const [starting, setStarting] = useState(false);

  // Pre-populate on open
  useEffect(() => {
    if (!open) return;
    setUrl(defaultUrl || "");
    setStarting(false);
    setShowAdvanced(false);

    const saved = loadImportUrlConfig();
    if (saved) {
      setMaxPages(saved.maxPages);
      setIncludePaths(saved.includePaths.join(", "));
      setExcludePaths(saved.excludePaths.join(", "));
      setMaxDepth(saved.maxDepth);
      setAllowSubdomains(saved.allowSubdomains);
      setConcurrency(saved.concurrency);
      setDelay(saved.delay);
    } else {
      setMaxPages(200);
      setIncludePaths("");
      setExcludePaths("");
      setMaxDepth(3);
      setAllowSubdomains(false);
      setConcurrency(3);
      setDelay(0);
    }
  }, [open, defaultUrl]);

  if (!open) return null;

  function parsePatterns(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleStart() {
    if (!url.trim() || starting) return;
    setStarting(true);
    try {
      const includeArr = parsePatterns(includePaths);
      const excludeArr = parsePatterns(excludePaths);

      const jobId = await startCrawl({
        kbId,
        startUrl: url.trim(),
        config: {
          maxPages: Math.min(Math.max(maxPages, 1), 1000),
          maxDepth,
          includePaths: includeArr.length ? includeArr : undefined,
          excludePaths: excludeArr.length ? excludeArr : undefined,
          allowSubdomains,
          concurrency: Math.min(Math.max(concurrency, 1), 10),
          delay: Math.max(delay, 0),
        },
      });

      saveImportUrlConfig({
        maxPages,
        includePaths: includeArr,
        excludePaths: excludeArr,
        maxDepth,
        allowSubdomains,
        concurrency,
        delay,
      });

      onStarted(jobId);
      onClose();
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-text">Import from URL</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="border-t border-border" />

        {/* Start URL */}
        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">Start URL *</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/docs"
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            autoFocus
          />
        </div>

        {/* Max Pages */}
        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            Max Pages <span className="normal-case text-text-dim">(1–1000)</span>
          </label>
          <input
            type="number"
            value={maxPages}
            onChange={(e) => setMaxPages(Number(e.target.value))}
            min={1}
            max={1000}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
          />
        </div>

        {/* Include / Exclude patterns */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wide">Include Paths</label>
            <input
              type="text"
              value={includePaths}
              onChange={(e) => setIncludePaths(e.target.value)}
              placeholder="/docs/**, /help/**"
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wide">Exclude Paths</label>
            <input
              type="text"
              value={excludePaths}
              onChange={(e) => setExcludePaths(e.target.value)}
              placeholder="/blog/**, /changelog/**"
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            />
          </div>
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-text-dim hover:text-accent transition-colors"
        >
          {showAdvanced ? "Hide Advanced" : "Advanced Options"}
        </button>

        {showAdvanced && (
          <div className="space-y-3 pl-2 border-l-2 border-border">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-text-muted uppercase tracking-wide">Max Depth</label>
                <input
                  type="number"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(Number(e.target.value))}
                  min={1}
                  max={10}
                  className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted uppercase tracking-wide">
                  Concurrency <span className="normal-case text-text-dim">(1–10)</span>
                </label>
                <input
                  type="number"
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  min={1}
                  max={10}
                  className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-text-muted uppercase tracking-wide">Delay (ms)</label>
                <input
                  type="number"
                  value={delay}
                  onChange={(e) => setDelay(Number(e.target.value))}
                  min={0}
                  className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="allowSubdomains"
                  checked={allowSubdomains}
                  onChange={(e) => setAllowSubdomains(e.target.checked)}
                  className="accent-accent"
                />
                <label htmlFor="allowSubdomains" className="text-xs text-text-dim">
                  Allow subdomains
                </label>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-border" />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-dim hover:text-text border border-border rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!url.trim() || starting}
            className="px-4 py-2 text-sm bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {starting ? "Starting..." : "Start Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/ImportUrlModal.tsx
git commit -m "feat(frontend): add ImportUrlModal with scraper config and localStorage

Full scraper configuration modal with primary fields (URL, max pages,
include/exclude patterns) and collapsible advanced options (depth,
subdomains, concurrency, delay). Persists config to localStorage."
```

---

## Task 7: Wire up ImportUrlModal in KB page

**Files:**
- Modify: `packages/frontend/src/app/kb/page.tsx`

- [ ] **Step 1: Update KB page to use ImportUrlModal**

In `packages/frontend/src/app/kb/page.tsx`:

Add import at top:
```typescript
import { ImportUrlModal } from "@/components/ImportUrlModal";
```

Replace the `showImportUrl` state variable with `showImportModal`:
```typescript
// Remove these lines:
const [showImportUrl, setShowImportUrl] = useState(false);
const [crawlUrl, setCrawlUrl] = useState("");
const [crawling, setCrawling] = useState(false);

// Add this line:
const [showImportModal, setShowImportModal] = useState(false);
```

Remove the `handleStartCrawl` function (lines 81-94).

Remove the unused `startCrawl` mutation import (line 62) — the `ImportUrlModal` handles this internally:
```typescript
// Remove this line:
const startCrawl = useMutation(api.scraping.orchestration.startCrawl);
```

Replace the Upload + Import section (the `<div className="p-3 border-b border-border space-y-2">` block, lines 228-299) with:

```tsx
{/* Upload + Import */}
<div className="p-3 border-b border-border space-y-2">
  <FileUploader kbId={selectedKbId} />
  <button
    onClick={() => setShowImportModal(true)}
    className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap"
  >
    Import from URL
  </button>

  {/* Crawl progress */}
  {crawlJob && (
    <div className="text-xs space-y-1">
      {crawlJob.status === "running" && (
        <div className="flex items-center justify-between">
          <span className="text-text-dim">
            Crawling... {crawlJob.stats.scraped}/
            {crawlJob.stats.discovered} pages
          </span>
          <button
            onClick={() => cancelCrawl({ jobId: crawlJobId! })}
            className="text-red-400 hover:text-red-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
      {crawlJob.status === "completed" && (
        <span className="text-accent">
          Done: {crawlJob.stats.scraped} pages
        </span>
      )}
      {crawlJob.status === "completed_with_errors" && (
        <span className="text-yellow-400">
          Done: {crawlJob.stats.scraped} scraped,{" "}
          {crawlJob.stats.failed} failed
        </span>
      )}
      {crawlJob.status === "failed" && (
        <span className="text-red-400">
          Failed: {crawlJob.error || "Unknown"}
        </span>
      )}
      {crawlJob.status === "cancelled" && (
        <span className="text-text-dim">
          Cancelled: {crawlJob.stats.scraped} pages
        </span>
      )}
    </div>
  )}
</div>
```

Add the ImportUrlModal before the closing `</div>` of the main component, near the existing CreateKBModal:

```tsx
{/* Import URL Modal */}
<ImportUrlModal
  open={showImportModal}
  onClose={() => setShowImportModal(false)}
  kbId={selectedKbId!}
  defaultUrl={selectedKb?.sourceUrl}
  onStarted={(jobId) => setCrawlJobId(jobId)}
/>
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd packages/frontend && npx next build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual test**

Start dev server (`pnpm dev`):
- Verify "Import from URL" is now a green accent button (not a subtle link)
- Click it — verify modal opens with KB's company URL pre-populated in Start URL
- Verify Max Pages defaults to 200
- Verify Advanced toggle shows/hides extra options
- Start an import — verify modal closes and crawl progress appears in the document panel
- Re-open modal — verify config persisted from localStorage (except URL)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/kb/page.tsx
git commit -m "feat(frontend): wire ImportUrlModal into KB page

Replace inline URL import toggle with primary accent button that opens
the full ImportUrlModal. Crawl progress UI preserved in document panel.
Remove unused showImportUrl, crawlUrl, crawling state variables."
```

---

## Task 8: Final verification

- [ ] **Step 1: Run eval-lib tests**

Run: `cd packages/eval-lib && npx vitest run`

Expected: All tests pass.

- [ ] **Step 2: Run backend type check**

Run: `pnpm typecheck:backend`

Expected: No errors.

- [ ] **Step 3: Build frontend**

Run: `cd packages/frontend && npx next build`

Expected: Build succeeds.

- [ ] **Step 4: Build eval-lib**

Run: `pnpm build`

Expected: eval-lib builds successfully.

- [ ] **Step 5: End-to-end manual test**

Start both dev servers (`pnpm dev` and `pnpm dev:backend`):
1. Create a KB with company name "TARS" and company URL "https://docs.hellotars.com"
2. Verify localStorage saved — close and reopen create modal, see "Previously used values"
3. Click "Import from URL" — verify URL pre-populated from KB
4. Start import with default settings (200 pages)
5. Wait for scraping to complete
6. Click on "How TARS Works" document — verify card grid content is present in rendered markdown
7. Click on homepage document — verify FAQ accordion content is present
8. Toggle to "raw" view — verify markdown source is clean (no nav/footer/script content)
