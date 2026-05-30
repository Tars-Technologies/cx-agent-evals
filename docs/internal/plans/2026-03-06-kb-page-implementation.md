# Knowledge Base Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated Knowledge Base page as the first tab, centralize all KB management there, and simplify the other three pages to a read-only KB dropdown.

**Architecture:** New `/kb` route with Layout B (top bar + master-detail split). New `KBDropdown` component replaces `KBSelector` on Generate/Retrievers/Experiments pages. Two small backend additions: a `documents.remove` mutation and a `knowledgeBases.listWithDocCounts` query. One minor fix: add `sourceType` to `documents.listByKb` return for the KB page document list.

**Tech Stack:** Next.js App Router, Convex (queries/mutations), React, Tailwind CSS v4, Clerk auth

**Design Doc:** `docs/plans/2026-03-06-kb-page-design.md`
**Wireframes:** `docs/diagrams/layout-b-topbar-split.excalidraw`, `docs/diagrams/create-kb-workflow.excalidraw`

---

## Phase 1: Backend Changes

### Task 1: Add `seedDocument` test helper and `documents.remove` mutation

**Files:**
- Modify: `packages/backend/tests/helpers.ts:77` (add seedDocument after seedDataset)
- Modify: `packages/backend/tests/documents.test.ts` (add remove tests)
- Modify: `packages/backend/convex/crud/documents.ts:84` (add remove mutation after get query)

**Step 1: Add `seedDocument` helper**

In `packages/backend/tests/helpers.ts`, add after the `seedDataset` function (after line 77):

```typescript
export async function seedDocument(
  t: ReturnType<typeof convexTest>,
  kbId: Id<"knowledgeBases">,
  overrides?: { title?: string; content?: string; sourceType?: string },
) {
  return await t.run(async (ctx) => {
    const title = overrides?.title ?? "Test Document";
    const content = overrides?.content ?? "# Test\n\nSample document content.";
    return await ctx.db.insert("documents", {
      orgId: TEST_ORG_ID,
      kbId,
      docId: title,
      title,
      content,
      contentLength: content.length,
      metadata: {},
      sourceType: overrides?.sourceType,
      createdAt: Date.now(),
    });
  });
}
```

**Step 2: Write the failing test for `documents.remove`**

Add to `packages/backend/tests/documents.test.ts`:

```typescript
import { expect, describe, it, beforeEach } from "vitest";
import { setupTest, seedUser, seedKB, seedDocument, TEST_ORG_ID, testIdentity } from "./helpers";
import { internal, api } from "../convex/_generated/api";

// ... existing tests ...

describe("documents: remove", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("deletes a document owned by the same org", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId, { title: "To Delete" });

    const authedT = t.withIdentity(testIdentity);
    await authedT.mutation(api.crud.documents.remove, { id: docId });

    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc).toBeNull();
  });

  it("throws when deleting a document from another org", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);

    const otherOrgIdentity = {
      ...testIdentity,
      org_id: "org_other999",
    };
    const otherT = t.withIdentity(otherOrgIdentity);

    await expect(
      otherT.mutation(api.crud.documents.remove, { id: docId }),
    ).rejects.toThrow("Document not found");
  });
});
```

**Step 3: Run test to verify it fails**

```bash
cd packages/backend && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `api.crud.documents.remove` does not exist yet.

**Step 4: Add the `remove` mutation**

In `packages/backend/convex/crud/documents.ts`, add after the `get` query (after line 84):

```typescript
export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Document not found");
    }
    if (doc.fileId) {
      await ctx.storage.delete(doc.fileId);
    }
    await ctx.db.delete(args.id);
  },
});
```

**Step 5: Run tests to verify they pass**

```bash
cd packages/backend && pnpm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: All tests PASS, including the two new `documents: remove` tests.

**Step 6: Commit**

```bash
git add packages/backend/convex/crud/documents.ts packages/backend/tests/helpers.ts packages/backend/tests/documents.test.ts
git commit -m "feat(backend): add documents.remove mutation and seedDocument test helper"
```

---

### Task 1b: Add `sourceType` to `documents.listByKb` return

The KB page document list needs to display a source type indicator. Currently `listByKb` (documents.ts:63-69) doesn't return `sourceType`.

**Files:**
- Modify: `packages/backend/convex/crud/documents.ts:63-69`

**Step 1: Update the listByKb map**

In `packages/backend/convex/crud/documents.ts`, change the return map at lines 63-69 from:

```typescript
    return docs.map((doc) => ({
      _id: doc._id,
      docId: doc.docId,
      title: doc.title,
      contentLength: doc.contentLength,
      createdAt: doc.createdAt,
    }));
```

to:

```typescript
    return docs.map((doc) => ({
      _id: doc._id,
      docId: doc.docId,
      title: doc.title,
      contentLength: doc.contentLength,
      sourceType: doc.sourceType,
      createdAt: doc.createdAt,
    }));
```

**Step 2: Run tests**

```bash
cd packages/backend && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: All tests PASS (this is a non-breaking addition).

**Step 3: Commit**

```bash
git add packages/backend/convex/crud/documents.ts
git commit -m "feat(backend): include sourceType in documents.listByKb return"
```

---

### Task 2: Add `knowledgeBases.listWithDocCounts` query

**Files:**
- Modify: `packages/backend/convex/crud/knowledgeBases.ts:78` (add after listByIndustry)
- Modify: `packages/backend/tests/knowledgeBases.test.ts` (add tests)

**Step 1: Write the failing test**

Add to `packages/backend/tests/knowledgeBases.test.ts`:

```typescript
import { expect, describe, it, beforeEach } from "vitest";
import { setupTest, seedUser, seedKB, seedDocument, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";

// ... existing tests ...

describe("knowledgeBases: listWithDocCounts", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("returns KBs with correct document counts", async () => {
    const userId = await seedUser(t);
    const kb1 = await seedKB(t, userId);
    const kb2Id = await t.run(async (ctx) =>
      ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID,
        name: "Empty KB",
        metadata: {},
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );

    await seedDocument(t, kb1, { title: "Doc 1" });
    await seedDocument(t, kb1, { title: "Doc 2" });
    await seedDocument(t, kb1, { title: "Doc 3" });

    const authedT = t.withIdentity(testIdentity);
    const results = await authedT.query(api.crud.knowledgeBases.listWithDocCounts, {});

    expect(results).toHaveLength(2);
    const kbWithDocs = results.find((kb) => kb.name === "Test KB");
    const emptyKb = results.find((kb) => kb.name === "Empty KB");
    expect(kbWithDocs!.documentCount).toBe(3);
    expect(emptyKb!.documentCount).toBe(0);
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
    const results = await authedT.query(
      api.crud.knowledgeBases.listWithDocCounts,
      { industry: "finance" },
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Finance KB");
    expect(results[0].documentCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/backend && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `api.crud.knowledgeBases.listWithDocCounts` does not exist yet.

**Step 3: Add the `listWithDocCounts` query**

In `packages/backend/convex/crud/knowledgeBases.ts`, add after `listByIndustry` (after line 78):

```typescript
export const listWithDocCounts = query({
  args: { industry: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    let kbs;
    if (args.industry) {
      kbs = await ctx.db
        .query("knowledgeBases")
        .withIndex("by_org_industry", (q) =>
          q.eq("orgId", orgId).eq("industry", args.industry!),
        )
        .order("desc")
        .collect();
    } else {
      kbs = await ctx.db
        .query("knowledgeBases")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .order("desc")
        .collect();
    }
    return Promise.all(
      kbs.map(async (kb) => {
        const docs = await ctx.db
          .query("documents")
          .withIndex("by_kb", (q) => q.eq("kbId", kb._id))
          .collect();
        return { ...kb, documentCount: docs.length };
      }),
    );
  },
});
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/backend && pnpm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: All tests PASS.

**Step 5: Verify Convex push**

```bash
cd packages/backend && npx convex dev --once
```

**Step 6: Commit**

```bash
git add packages/backend/convex/crud/knowledgeBases.ts packages/backend/tests/knowledgeBases.test.ts
git commit -m "feat(backend): add listWithDocCounts query for KB dropdown"
```

---

## Phase 2: Shared Frontend Components

### Task 3: Create `KBDropdown` component

Simplified read-only KB selector for Generate/Retrievers/Experiments pages. Shows a single dropdown with KB name and doc count. No create, upload, import, or document list.

**Files:**
- Create: `packages/frontend/src/components/KBDropdown.tsx`

**Step 1: Create the component**

```typescript
"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface KBDropdownProps {
  selectedKbId: Id<"knowledgeBases"> | null;
  onSelect: (kbId: Id<"knowledgeBases">) => void;
}

export function KBDropdown({ selectedKbId, onSelect }: KBDropdownProps) {
  const kbs = useQuery(api.crud.knowledgeBases.listWithDocCounts, {});

  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
        Knowledge Base
      </label>
      {kbs === undefined ? (
        <div className="flex items-center gap-2 text-text-dim text-sm">
          <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          Loading...
        </div>
      ) : (
        <select
          value={selectedKbId ?? ""}
          onChange={(e) => {
            if (e.target.value) {
              onSelect(e.target.value as Id<"knowledgeBases">);
            }
          }}
          className="flex-1 bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
        >
          <option value="">Select a knowledge base...</option>
          {kbs.map((kb) => (
            <option key={kb._id} value={kb._id}>
              {kb.name} ({kb.documentCount} {kb.documentCount === 1 ? "doc" : "docs"})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Expected: No errors.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/KBDropdown.tsx
git commit -m "feat(frontend): add KBDropdown read-only KB selector component"
```

---

### Task 4: Create `CreateKBModal` component

Modal dialog for creating a new KB. Fields: Name (required), Industry, Entity Type, Company, Source URL. On submit, calls `knowledgeBases.create` and returns the new ID.

**Files:**
- Create: `packages/frontend/src/components/CreateKBModal.tsx`

**Reference:** `knowledgeBases.create` mutation accepts: `name` (required), `description?`, `metadata?`, `industry?`, `subIndustry?`, `company?`, `entityType?`, `sourceUrl?`, `tags?` — see `packages/backend/convex/crud/knowledgeBases.ts:5-16`.

**Step 1: Create the modal component**

```typescript
"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

const INDUSTRIES = [
  "finance",
  "insurance",
  "healthcare",
  "telecom",
  "education",
  "government",
] as const;

const ENTITY_TYPES = [
  "company",
  "government-state",
  "government-county",
  "industry-aggregate",
] as const;

interface CreateKBModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (kbId: Id<"knowledgeBases">) => void;
}

export function CreateKBModal({ open, onClose, onCreated }: CreateKBModalProps) {
  const createKb = useMutation(api.crud.knowledgeBases.create);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [entityType, setEntityType] = useState("");
  const [company, setCompany] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  async function handleCreate() {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createKb({
        name: name.trim(),
        ...(industry && { industry }),
        ...(entityType && { entityType }),
        ...(company.trim() && { company: company.trim() }),
        ...(sourceUrl.trim() && { sourceUrl: sourceUrl.trim() }),
      });
      setName("");
      setIndustry("");
      setEntityType("");
      setCompany("");
      setSourceUrl("");
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
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text-dim focus:border-accent outline-none"
            >
              <option value="">Select industry...</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind.charAt(0).toUpperCase() + ind.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wide">Entity Type</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text-dim focus:border-accent outline-none"
            >
              <option value="">Select type...</option>
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
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Acme Inc"
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">Source URL</label>
          <input
            type="text"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://acme.com/support"
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

**Step 2: Verify it compiles**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Expected: No errors.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/CreateKBModal.tsx
git commit -m "feat(frontend): add CreateKBModal component"
```

---

## Phase 3: KB Page

### Task 5: Create the `/kb` page

This is the main KB page with Layout B: top bar for KB selection/metadata, master-detail split below (document list left, document content right).

**Files:**
- Create: `packages/frontend/src/app/kb/page.tsx`

**Dependencies:** Tasks 1, 1b, 2, 3, 4 must be complete.

**Convex API calls used:**
- `api.crud.knowledgeBases.listWithDocCounts` — KB dropdown with doc counts (Task 2)
- `api.crud.documents.listByKb` — document list for selected KB (existing, updated in Task 1b)
- `api.crud.documents.get` — full document content for viewer (existing)
- `api.crud.documents.remove` — delete documents (Task 1)
- `api.scraping.orchestration.startCrawl` — URL import (existing)
- `api.scraping.orchestration.cancelCrawl` — cancel crawl (existing)
- `api.scraping.orchestration.getJob` — crawl progress (existing)

**Components used:**
- `Header` (existing, with `mode="kb"` — updated in Task 6)
- `FileUploader` (existing, relocated from KBSelector)
- `CreateKBModal` (Task 4)

**Hooks used:**
- `useKbFromUrl()` — KB selection state via `?kb=` URL param (existing, `packages/frontend/src/lib/useKbFromUrl.ts`)

**Step 1: Create the page file**

Create `packages/frontend/src/app/kb/page.tsx`:

```typescript
"use client";

import { Suspense, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useKbFromUrl } from "@/lib/useKbFromUrl";
import { FileUploader } from "@/components/FileUploader";
import { CreateKBModal } from "@/components/CreateKBModal";

const INDUSTRIES = [
  "finance", "insurance", "healthcare", "telecom", "education", "government",
] as const;

export default function KBPage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen"><Header mode="kb" /></div>}>
      <KBPageContent />
    </Suspense>
  );
}

function KBPageContent() {
  // --- KB selection ---
  const [selectedKbId, setSelectedKbId] = useKbFromUrl();
  const [industryFilter, setIndustryFilter] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // --- Document state ---
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(null);
  const [docSearchQuery, setDocSearchQuery] = useState("");

  // --- Crawl state (same pattern as KBSelector.tsx:48-72) ---
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlJobId, setCrawlJobId] = useState<Id<"crawlJobs"> | null>(null);
  const [crawling, setCrawling] = useState(false);

  // --- Queries ---
  const kbs = useQuery(
    api.crud.knowledgeBases.listWithDocCounts,
    industryFilter ? { industry: industryFilter } : {},
  );
  const documents = useQuery(
    api.crud.documents.listByKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const selectedDoc = useQuery(
    api.crud.documents.get,
    selectedDocId ? { id: selectedDocId } : "skip",
  );
  const crawlJob = useQuery(
    api.scraping.orchestration.getJob,
    crawlJobId ? { jobId: crawlJobId } : "skip",
  );

  // --- Mutations ---
  const removeDoc = useMutation(api.crud.documents.remove);
  const startCrawl = useMutation(api.scraping.orchestration.startCrawl);
  const cancelCrawl = useMutation(api.scraping.orchestration.cancelCrawl);

  // --- Derived ---
  const selectedKb = kbs?.find((kb) => kb._id === selectedKbId);
  const filteredDocs = documents?.filter(
    (doc) =>
      !docSearchQuery ||
      doc.title.toLowerCase().includes(docSearchQuery.toLowerCase()),
  );

  // Reset doc selection when KB changes
  useEffect(() => {
    setSelectedDocId(null);
    setDocSearchQuery("");
    setCrawlJobId(null);
  }, [selectedKbId]);

  // --- Handlers ---
  async function handleStartCrawl() {
    if (!crawlUrl.trim() || !selectedKbId || crawling) return;
    setCrawling(true);
    try {
      const jobId = await startCrawl({
        kbId: selectedKbId,
        startUrl: crawlUrl.trim(),
      });
      setCrawlJobId(jobId);
      setCrawlUrl("");
    } finally {
      setCrawling(false);
    }
  }

  async function handleDeleteDoc(docId: Id<"documents">) {
    try {
      await removeDoc({ id: docId });
      if (selectedDocId === docId) {
        setSelectedDocId(null);
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }

  function handleKBCreated(kbId: Id<"knowledgeBases">) {
    setShowCreateModal(false);
    setSelectedKbId(kbId);
  }

  return (
    <div className="flex flex-col h-screen">
      <Header mode="kb" kbId={selectedKbId} />

      {/* ── KB Selection & Metadata Bar ── */}
      <div className="border-b border-border bg-bg-elevated px-6 py-3 space-y-2">
        {/* Row 1: KB dropdown, industry filter, create button */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
              KB
            </label>
            {kbs === undefined ? (
              <div className="flex items-center gap-2 text-text-dim text-sm">
                <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                Loading...
              </div>
            ) : (
              <select
                value={selectedKbId ?? ""}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedKbId(e.target.value as Id<"knowledgeBases">);
                  }
                }}
                className="flex-1 max-w-xs bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none"
              >
                <option value="">Select a knowledge base...</option>
                {kbs.map((kb) => (
                  <option key={kb._id} value={kb._id}>
                    {kb.name} ({kb.documentCount}{" "}
                    {kb.documentCount === 1 ? "doc" : "docs"})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
              Industry
            </label>
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              className="bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none"
            >
              <option value="">All</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind.charAt(0).toUpperCase() + ind.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap"
          >
            + Create KB
          </button>
        </div>

        {/* Row 2: Metadata line */}
        {selectedKb && (
          <div className="flex items-center gap-3 text-xs text-text-dim">
            {selectedKb.company && <span>Company: {selectedKb.company}</span>}
            {selectedKb.company && selectedKb.entityType && (
              <span className="text-border">|</span>
            )}
            {selectedKb.entityType && (
              <span>Entity: {selectedKb.entityType}</span>
            )}
            {(selectedKb.company || selectedKb.entityType) && (
              <span className="text-border">|</span>
            )}
            <span>
              {selectedKb.documentCount} document
              {selectedKb.documentCount !== 1 ? "s" : ""}
            </span>
            {selectedKb.sourceUrl && (
              <>
                <span className="text-border">|</span>
                <a
                  href={selectedKb.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent/80 transition-colors"
                >
                  {selectedKb.sourceUrl}
                </a>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Master-Detail Split ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Document Panel (left, ~30%) */}
        <div className="w-80 border-r border-border flex flex-col bg-bg-elevated">
          {selectedKbId ? (
            <>
              {/* Search */}
              <div className="p-3 border-b border-border">
                <input
                  type="text"
                  value={docSearchQuery}
                  onChange={(e) => setDocSearchQuery(e.target.value)}
                  placeholder="Search documents..."
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none"
                />
              </div>

              {/* Upload + Import */}
              <div className="p-3 border-b border-border space-y-2">
                <FileUploader kbId={selectedKbId} />

                <button
                  onClick={() => setShowImportUrl(!showImportUrl)}
                  className="text-xs text-text-dim hover:text-accent transition-colors"
                >
                  {showImportUrl ? "Hide URL Import" : "Import from URL"}
                </button>

                {showImportUrl && (
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={crawlUrl}
                      onChange={(e) => setCrawlUrl(e.target.value)}
                      placeholder="https://example.com/docs"
                      className="flex-1 bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent outline-none"
                      disabled={crawling}
                      onKeyDown={(e) => e.key === "Enter" && handleStartCrawl()}
                    />
                    <button
                      onClick={handleStartCrawl}
                      disabled={!crawlUrl.trim() || crawling}
                      className="px-3 py-1 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
                    >
                      {crawling ? "..." : "Go"}
                    </button>
                  </div>
                )}

                {/* Crawl progress (same UI as KBSelector.tsx:238-274) */}
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

              {/* Document list (scrollable) */}
              <div className="flex-1 overflow-y-auto">
                {documents === undefined ? (
                  <div className="p-4 flex items-center gap-2 text-text-dim text-xs">
                    <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    Loading...
                  </div>
                ) : filteredDocs && filteredDocs.length > 0 ? (
                  filteredDocs.map((doc) => (
                    <div
                      key={doc._id}
                      onClick={() => setSelectedDocId(doc._id)}
                      className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                        selectedDocId === doc._id
                          ? "bg-accent/10 border-l-2 border-l-accent"
                          : "hover:bg-bg-hover"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-text truncate">
                          {doc.title}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-text-dim mt-0.5">
                          <span>
                            {(doc.contentLength / 1024).toFixed(1)}k
                          </span>
                          {doc.sourceType && (
                            <span className="px-1 py-0.5 rounded bg-accent/10 text-accent text-[9px]">
                              {doc.sourceType}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDoc(doc._id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 transition-all p-1"
                        title="Delete document"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-xs text-text-dim">
                    {docSearchQuery
                      ? "No matching documents."
                      : "No documents yet. Upload files or import from URL."}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-4 text-xs text-text-dim">
              Select a knowledge base to manage its documents.
            </div>
          )}
        </div>

        {/* Content Viewer (right, ~70%) */}
        <div className="flex-1 overflow-hidden flex flex-col bg-bg">
          {selectedDoc ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-elevated/50">
                <span className="text-xs text-accent font-medium">
                  {selectedDoc.title}
                </span>
                <div className="flex items-center gap-3 text-[10px] text-text-dim">
                  <span>
                    {(selectedDoc.contentLength / 1024).toFixed(1)}k
                  </span>
                  {selectedDoc.sourceType && (
                    <span className="text-accent">
                      {selectedDoc.sourceType}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <pre className="text-xs text-text-muted leading-[1.8] whitespace-pre-wrap break-all font-[inherit]">
                  {selectedDoc.content}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
              Select a document to view its content
            </div>
          )}
        </div>
      </div>

      {/* Create KB Modal */}
      <CreateKBModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleKBCreated}
      />
    </div>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Expected: No errors (or only pre-existing errors). Note: Header may show a type error for `mode="kb"` until Task 6 is complete. If so, proceed to Task 6 first or temporarily cast: `mode={"kb" as any}`.

**Step 3: Manual verification**

```bash
cd packages/frontend && pnpm dev
```

Navigate to `http://localhost:3000/kb` and verify:
- KB dropdown loads and lists KBs with doc counts
- Industry filter works
- Creating a KB via modal works and auto-selects the new KB
- Upload documents works (drag-and-drop zone)
- Import URL: expand input, start crawl, see progress, cancel
- Clicking a document shows its full content on the right
- Delete button appears on hover, deleting removes the doc
- KB selection persists in URL (`?kb=<id>`)

**Step 4: Commit**

```bash
git add packages/frontend/src/app/kb/
git commit -m "feat(frontend): add KB management page with Layout B"
```

---

## Phase 4: Navigation Updates

### Task 6: Update Header component

**Files:**
- Modify: `packages/frontend/src/components/Header.tsx`

**Reference:** Current Header at `packages/frontend/src/components/Header.tsx` — mode type on line 9, tabs on lines 28-59.

**Step 1: Add `"kb"` to the mode type**

Change line 9 from:

```typescript
  mode?: "generate" | "retrievers" | "experiments";
```

to:

```typescript
  mode?: "kb" | "generate" | "retrievers" | "experiments";
```

**Step 2: Add the KB tab**

Insert a new `<Link>` before the Generate tab (before line 29). The existing tabs are at lines 29-58. Add the KB tab as the first tab in the flex group:

Change lines 28-59 from:

```typescript
              <div className="flex gap-1 bg-bg rounded-md p-0.5">
                <Link
                  href={buildKbLink("/generate", kbId ?? null)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "generate"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Generate
                </Link>
                <Link
                  href={buildKbLink("/retrievers", kbId ?? null)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "retrievers"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Retrievers
                </Link>
                <Link
                  href={buildKbLink("/experiments", kbId ?? null)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "experiments"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Experiments
                </Link>
              </div>
```

to:

```typescript
              <div className="flex gap-1 bg-bg rounded-md p-0.5">
                <Link
                  href={buildKbLink("/kb", kbId ?? null)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "kb"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Knowledge Base
                </Link>
                <Link
                  href={buildKbLink("/generate", kbId ?? null)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "generate"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Generate
                </Link>
                <Link
                  href={buildKbLink("/retrievers", kbId ?? null)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "retrievers"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Retrievers
                </Link>
                <Link
                  href={buildKbLink("/experiments", kbId ?? null)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "experiments"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Experiments
                </Link>
              </div>
```

**Step 3: Verify**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Expected: No errors.

**Step 4: Commit**

```bash
git add packages/frontend/src/components/Header.tsx
git commit -m "feat(frontend): add Knowledge Base tab to header navigation"
```

---

### Task 7: Update ModeSelector (landing page)

**Files:**
- Modify: `packages/frontend/src/components/ModeSelector.tsx`

**Reference:** Current ModeSelector at `packages/frontend/src/components/ModeSelector.tsx` — grid on line 24, first card starts at line 26.

**Step 1: Change grid layout**

Change line 24 from:

```typescript
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
```

to:

```typescript
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
```

**Step 2: Add KB card before the Generate card**

Insert a new card between line 24 (grid opening) and line 26 (Generate card start):

```typescript
          {/* Knowledge Base Card */}
          <Link
            href="/kb"
            className="group block border border-border rounded-lg bg-bg-elevated p-8 hover:border-accent/50 hover:bg-bg-elevated/80 transition-all duration-200"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <svg
                  className="w-5 h-5 text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-text group-hover:text-accent transition-colors">
                Knowledge Base
              </h2>
            </div>
            <p className="text-text-muted text-sm leading-relaxed">
              Create and manage knowledge bases. Upload documents, import from
              URLs, and organize your data.
            </p>
            <div className="mt-6 text-xs text-text-dim flex items-center gap-2">
              <span>Create KB</span>
              <span className="text-border">&rarr;</span>
              <span>Upload docs</span>
              <span className="text-border">&rarr;</span>
              <span>Import URLs</span>
            </div>
          </Link>
```

**Step 3: Verify**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Navigate to `http://localhost:3000/` and verify 4 cards show in a grid.

**Step 4: Commit**

```bash
git add packages/frontend/src/components/ModeSelector.tsx
git commit -m "feat(frontend): add Knowledge Base card to landing page"
```

---

## Phase 5: Simplify Other Pages

### Task 8: Simplify Generate page

Replace the full `KBSelector` (with create, upload, crawl, doc list) with the read-only `KBDropdown`.

**Files:**
- Modify: `packages/frontend/src/app/generate/page.tsx`

**Reference:** Current generate page at `packages/frontend/src/app/generate/page.tsx` — KBSelector import on line 9, usage on line 299.

**Step 1: Replace import**

Change line 9 from:

```typescript
import { KBSelector } from "@/components/KBSelector";
```

to:

```typescript
import { KBDropdown } from "@/components/KBDropdown";
```

**Step 2: Replace KBSelector usage with KBDropdown**

Change line 299 from:

```typescript
            <KBSelector selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
```

to:

```typescript
            <KBDropdown selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
```

**Step 3: Verify**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Navigate to `/generate` and verify:
- Simple KB dropdown shows with doc counts
- No upload, import, create, or document list in sidebar
- Dataset selection and generation still work

**Step 4: Commit**

```bash
git add packages/frontend/src/app/generate/page.tsx
git commit -m "refactor(frontend): simplify generate page with read-only KBDropdown"
```

---

### Task 9: Simplify Retrievers page

**Files:**
- Modify: `packages/frontend/src/app/retrievers/page.tsx`

**Reference:** Current retrievers page at `packages/frontend/src/app/retrievers/page.tsx` — KBSelector import on line 9, usage on lines 299-302 (wrapped in bordered box at lines 294-304).

**Step 1: Replace import**

Change line 9 from:

```typescript
import { KBSelector } from "@/components/KBSelector";
```

to:

```typescript
import { KBDropdown } from "@/components/KBDropdown";
```

**Step 2: Replace KBSelector usage**

Change lines 298-303 from:

```typescript
              <div className="p-4">
                <KBSelector
                  selectedKbId={selectedKbId}
                  onSelect={setSelectedKbId}
                />
              </div>
```

to:

```typescript
              <div className="p-4">
                <KBDropdown
                  selectedKbId={selectedKbId}
                  onSelect={setSelectedKbId}
                />
              </div>
```

The bordered box wrapper (lines 294-304) stays — it provides the "Knowledge Base" section header.

**Step 3: Verify**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Navigate to `/retrievers` and verify the simplified dropdown works.

**Step 4: Commit**

```bash
git add packages/frontend/src/app/retrievers/page.tsx
git commit -m "refactor(frontend): simplify retrievers page with read-only KBDropdown"
```

---

### Task 10: Simplify Experiments page

**Files:**
- Modify: `packages/frontend/src/app/experiments/page.tsx`

**Reference:** Current experiments page at `packages/frontend/src/app/experiments/page.tsx` — KBSelector import on line 8, usage on line 147 (wrapped in bordered box at lines 142-149).

**Step 1: Replace import**

Change line 8 from:

```typescript
import { KBSelector } from "@/components/KBSelector";
```

to:

```typescript
import { KBDropdown } from "@/components/KBDropdown";
```

**Step 2: Replace KBSelector usage**

Change line 147 from:

```typescript
                <KBSelector selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
```

to:

```typescript
                <KBDropdown selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
```

The bordered box wrapper (lines 142-149) stays.

**Step 3: Verify**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Navigate to `/experiments` and verify the simplified dropdown works.

**Step 4: Commit**

```bash
git add packages/frontend/src/app/experiments/page.tsx
git commit -m "refactor(frontend): simplify experiments page with read-only KBDropdown"
```

---

## Phase 6: Cleanup

### Task 11: Clean up old KBSelector

**Files:**
- Delete (if unused): `packages/frontend/src/components/KBSelector.tsx`

**Step 1: Check if KBSelector is still imported anywhere**

```bash
cd packages/frontend && grep -r "KBSelector" src/ --include="*.tsx" --include="*.ts"
```

Expected: No results (all three pages now use KBDropdown, KB page has its own layout).

**Step 2: Delete KBSelector.tsx**

If Step 1 confirms no imports remain:

```bash
rm packages/frontend/src/components/KBSelector.tsx
```

**Step 3: Verify everything compiles and builds**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | tail -10
cd packages/frontend && pnpm build 2>&1 | tail -20
```

Expected: No errors. Build succeeds.

**Step 4: Run backend tests to confirm nothing is broken**

```bash
cd packages/backend && pnpm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: All tests PASS.

**Step 5: Full manual test**

1. Landing page (`/`) shows 4 cards (KB, Generate, Retrievers, Experiments)
2. KB page (`/kb`): create KB, upload docs, import URL, view document content, delete doc
3. Generate page (`/generate`): read-only KB dropdown with doc count, generation works
4. Retrievers page (`/retrievers`): read-only KB dropdown, pipeline config works
5. Experiments page (`/experiments`): read-only KB dropdown, experiment run works
6. KB selection persists across page navigation via URL param (`?kb=<id>`)
7. Header tabs navigate correctly, KB tab is highlighted on `/kb`

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(frontend): remove unused KBSelector, cleanup imports"
```

---

## Task Summary

| Task | Phase | Description | Files |
|------|-------|-------------|-------|
| 1 | Backend | Add `seedDocument` helper + `documents.remove` mutation | `tests/helpers.ts`, `tests/documents.test.ts`, `convex/crud/documents.ts` |
| 1b | Backend | Add `sourceType` to `listByKb` return | `convex/crud/documents.ts` |
| 2 | Backend | Add `listWithDocCounts` query | `convex/crud/knowledgeBases.ts`, `tests/knowledgeBases.test.ts` |
| 3 | Components | Create `KBDropdown` component | `components/KBDropdown.tsx` |
| 4 | Components | Create `CreateKBModal` component | `components/CreateKBModal.tsx` |
| 5 | KB Page | Create `/kb` page (Layout B) | `app/kb/page.tsx` |
| 6 | Navigation | Update Header with KB tab | `components/Header.tsx` |
| 7 | Navigation | Update ModeSelector landing page | `components/ModeSelector.tsx` |
| 8 | Simplify | Generate page → KBDropdown | `app/generate/page.tsx` |
| 9 | Simplify | Retrievers page → KBDropdown | `app/retrievers/page.tsx` |
| 10 | Simplify | Experiments page → KBDropdown | `app/experiments/page.tsx` |
| 11 | Cleanup | Remove old KBSelector if unused | `components/KBSelector.tsx` |

## Dependency Graph

```
Task 1 ──┬── Task 1b
         │
Task 2 ──┤
         │
Task 3 ──┤
         │
Task 4 ──┴── Task 5 ──── Task 6 ──── Task 7
                                       │
              Task 8 ─────────────────┤
              Task 9 ─────────────────┤
              Task 10 ────────────────┴── Task 11
```

Tasks 1, 1b, 2, 3, 4 can run in parallel.
Tasks 6, 7 can run in parallel after Task 5.
Tasks 8, 9, 10 can run in parallel (depend on Task 3).
Task 11 runs last.
