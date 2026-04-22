# Generation Wizard Main-Pane Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `GenerationWizard` out of the cramped 360px sidebar into the main content pane, persist wizard config + dimension discover URL per-KB, and fix the pre-existing bug where document priorities don't survive reloads.

**Architecture:** The `/generate` page already has a `browse` / `generate` mode state. This plan reuses that mode and swaps what the **main pane** renders: question list + doc viewer in `browse` mode, the full-width wizard card in `generate` mode. The sidebar remains unchanged except for adding a prominent `+ New Generation` button above the dataset list. No new top-level state, no new routes, no new components — only layout refactoring and a few localStorage key changes.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Convex (backend queries), JetBrains Mono font, existing design tokens in `packages/frontend/src/app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-04-09-generation-wizard-main-pane-redesign.md`

---

## File Map

### Backend (modified)

| File | Responsibility |
|------|---------------|
| `packages/backend/convex/crud/documents.ts` | `listByKb` query — add `priority` to the returned object. |

### Frontend (modified)

| File | Responsibility |
|------|---------------|
| `packages/frontend/src/app/generate/page.tsx` | Stop hardcoding `priority: 3`. Add `+ New Generation` button above the dataset list. Render `<GenerationWizard>` in the main pane when `mode === "generate"`. Implement `handleCancelGeneration`. |
| `packages/frontend/src/components/GenerationWizard.tsx` | Replace sidebar layout with full-width card (header + stepper + content). Accept `onCancel` prop. Switch to per-KB localStorage key scheme. Add one-time migration from old global keys. Pass `kbId` to `WizardStepDimensions`. |
| `packages/frontend/src/components/WizardStepRealWorld.tsx` | Grow textarea to `min-h-[200px]`. Move counter below textarea. |
| `packages/frontend/src/components/WizardStepDimensions.tsx` | Accept `kbId` prop. Switch dimension list to responsive 2-column grid. Use per-KB localStorage key for discover URL. |
| `packages/frontend/src/components/WizardStepPreferences.tsx` | Two-column grid layout for tone + question types on `md:` and up, focus areas full-row below. |
| `packages/frontend/src/components/WizardStepReview.tsx` | Wrap priority table in `max-h-[360px] overflow-y-auto` with sticky `thead`. |

No new files created. No files deleted.

---

## Verification Approach

This is a pure UI refactor. There are no new behaviors that warrant unit tests. Each task is verified by:

1. **TypeScript compilation:** `pnpm -C packages/frontend build` (must succeed with no errors)
2. **Backend deploy dry-run:** `cd packages/backend && npx convex dev --once` (for backend changes only)
3. **Manual visual check** in the browser via `pnpm dev` at the end of relevant tasks

Existing backend tests are run once at the end of Task 1 to confirm the `listByKb` change doesn't break anything: `pnpm -C packages/backend test`.

---

## Task 1: Backend — Expose `priority` in `listByKb`

**Files:**
- Modify: `packages/backend/convex/crud/documents.ts:46-72`

**Why this task first:** The Review step's priority dots currently reset on reload because the query doesn't return the field. Fixing this unblocks the frontend from reading real priorities.

- [ ] **Step 1: Read the current `listByKb` implementation**

Read `packages/backend/convex/crud/documents.ts` lines 46–72 to confirm the current shape of the return object.

- [ ] **Step 2: Add `priority` to the returned object**

In `listByKb`, find the `return docs.map((doc) => ({ ... }))` block. Add `priority: doc.priority` to the object (the schema already has this field — it's just not being exposed).

Final shape should look like:

```typescript
return docs.map((doc) => ({
  _id: doc._id,
  docId: doc.docId,
  title: doc.title,
  contentLength: doc.contentLength,
  sourceType: doc.sourceType,
  createdAt: doc.createdAt,
  priority: doc.priority,
}));
```

- [ ] **Step 3: Deploy to Convex and verify no errors**

Run: `cd packages/backend && npx convex dev --once`
Expected: `✔ Convex functions ready!` with no type errors.

- [ ] **Step 4: Run existing backend tests**

Run: `pnpm -C packages/backend test`
Expected: All tests pass. If any test asserts on the exact shape of `listByKb` output and breaks, update that assertion to include `priority`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/crud/documents.ts
git commit -m "fix(backend): expose priority field in listByKb query

Required by the generate page so document priorities persist across
reloads. Schema already had the field; only the query projection was
missing it."
```

---

## Task 2: Frontend — Use real priority in `generate/page.tsx`

**Files:**
- Modify: `packages/frontend/src/app/generate/page.tsx` (the `documents` prop construction passed to `GenerationWizard`)

**Why this task second:** Task 1 exposes the field; this task uses it. After this, priority dots actually persist.

- [ ] **Step 1: Read the current `documents` prop construction**

Read `packages/frontend/src/app/generate/page.tsx` around lines 365–395. Find the `<GenerationWizard>` usage with `documents={(documentsData ?? []).map(...)}`. Current code hardcodes `priority: 3`.

- [ ] **Step 2: Read from the query result instead of hardcoding**

Change the inline `map` to:

```typescript
documents={(documentsData ?? []).map((d) => ({
  _id: d._id as string,
  docId: d.docId,
  title: d.title,
  priority: d.priority ?? 3,
}))}
```

The `?? 3` fallback guards against any pre-existing document rows where `priority` might be undefined (Convex returns `undefined` for missing optional fields).

- [ ] **Step 3: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds with no type errors. If TypeScript complains that `priority` doesn't exist on the `listByKb` return type, it means Convex client types weren't regenerated — re-run `npx convex dev --once` in `packages/backend/` first to refresh generated types.

- [ ] **Step 4: Manual check**

Start the dev stack (`pnpm dev:backend` in one terminal, `pnpm dev` in another). Open `/generate`, select a KB, click `+ New Generation` (or "Generate Questions" — the current sidebar entry), advance to step 4, change a document's priority to 5, reload the page, re-open the wizard, advance to step 4. The priority should still be 5.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/generate/page.tsx
git commit -m "fix(frontend): read real document priority from listByKb

Stops hardcoding priority: 3 so the Review step's priority dots persist
across page reloads. Depends on the listByKb backend fix in the
previous commit."
```

---

## Task 3: Per-KB localStorage for wizard config + migration

**Files:**
- Modify: `packages/frontend/src/components/GenerationWizard.tsx`

**Why this task third:** The layout changes in Task 5 are easier to verify if the storage is already working per-KB. Splitting storage first also keeps the commit small.

- [ ] **Step 1: Read the current GenerationWizard storage code**

Read `packages/frontend/src/components/GenerationWizard.tsx` lines 13–75. Note:
- Current global key: `const STORAGE_KEY = "rag-eval:unified-wizard-config";`
- Current read in `useState` initializer (line 56–64).
- Current write in `useEffect` (line 67–73).

- [ ] **Step 2: Replace constants with per-KB key helpers**

At the top of the file (around line 13), replace:

```typescript
const STORAGE_KEY = "rag-eval:unified-wizard-config";
```

with:

```typescript
const WIZARD_CONFIG_PREFIX = "rag-eval:unified-wizard-config:";
const OLD_WIZARD_CONFIG_KEY = "rag-eval:unified-wizard-config";
const wizardKey = (kbId: string) => `${WIZARD_CONFIG_PREFIX}${kbId}`;
```

- [ ] **Step 3: Update the `useState` initializer to use the per-KB key**

Replace:

```typescript
const [config, setConfig] = useState<UnifiedWizardConfig>(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch {
    // Ignore corrupted localStorage
  }
  return DEFAULT_CONFIG;
});
```

with:

```typescript
const [config, setConfig] = useState<UnifiedWizardConfig>(() => {
  try {
    const saved = localStorage.getItem(wizardKey(kbId));
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch {
    // Ignore corrupted localStorage
  }
  return DEFAULT_CONFIG;
});
```

- [ ] **Step 4: Reload config when kbId changes**

Add a new `useEffect` after the existing `useEffect` that persists config:

```typescript
// Reload config when KB changes
useEffect(() => {
  try {
    const saved = localStorage.getItem(wizardKey(kbId));
    if (saved) {
      setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
    } else {
      setConfig(DEFAULT_CONFIG);
    }
  } catch {
    setConfig(DEFAULT_CONFIG);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [kbId]);
```

The `eslint-disable` is because we intentionally don't want this effect to fire on `DEFAULT_CONFIG` changes (it's a constant anyway).

- [ ] **Step 5: Update the persist effect to use the per-KB key**

Replace:

```typescript
useEffect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage full or unavailable
  }
}, [config]);
```

with:

```typescript
useEffect(() => {
  try {
    localStorage.setItem(wizardKey(kbId), JSON.stringify(config));
  } catch {
    // localStorage full or unavailable
  }
}, [config, kbId]);
```

- [ ] **Step 6: Add the one-time migration effect**

After the config-persist `useEffect`, add the migration effect:

```typescript
// One-time migration from the old global storage key
useEffect(() => {
  try {
    const oldValue = localStorage.getItem(OLD_WIZARD_CONFIG_KEY);
    if (oldValue == null) return;
    const currentKey = wizardKey(kbId);
    // Only seed if this KB doesn't already have its own entry
    if (localStorage.getItem(currentKey) == null) {
      localStorage.setItem(currentKey, oldValue);
    }
    localStorage.removeItem(OLD_WIZARD_CONFIG_KEY);
  } catch {
    // Silent — migration is best-effort
  }
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

- [ ] **Step 7: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 8: Manual check**

1. In DevTools, set `localStorage.setItem("rag-eval:unified-wizard-config", JSON.stringify({ totalQuestions: 77 }))`.
2. Reload the `/generate` page.
3. Open the wizard and advance to Review step.
4. Verify total questions shows 77.
5. Verify the old key is gone: `localStorage.getItem("rag-eval:unified-wizard-config")` → `null`.
6. Verify the new key exists: `localStorage.getItem("rag-eval:unified-wizard-config:<your_kb_id>")` → contains `totalQuestions: 77`.
7. Switch to a different KB. Verify the wizard resets to 30 (default). Switch back — verify 77 returns.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/components/GenerationWizard.tsx
git commit -m "feat(frontend): persist wizard config per-KB in localStorage

Wizard config (real-world questions, dimensions, preferences, total
questions) is now keyed by KB id, so settings don't bleed across
knowledge bases. Includes a one-time migration from the old global key."
```

---

## Task 4: Per-KB localStorage for dimension discover URL

**Files:**
- Modify: `packages/frontend/src/components/GenerationWizard.tsx` (pass `kbId` to the dimensions step + add migration)
- Modify: `packages/frontend/src/components/WizardStepDimensions.tsx` (accept `kbId` prop, use per-KB key)

- [ ] **Step 1: Read current discover URL code in `WizardStepDimensions`**

Read `packages/frontend/src/components/WizardStepDimensions.tsx` lines 14–41. Note:
- Current global key: `"rag-eval:dimension-discover-url"`
- Read in `useState` initializer (line 15–18).
- Write inside `handleDiscover` (line 35).

- [ ] **Step 2: Add `kbId` to `WizardStepDimensionsProps` and use per-KB key**

Replace the props interface and storage code:

```typescript
interface WizardStepDimensionsProps {
  kbId: string;
  dimensions: Dimension[];
  onChange: (dimensions: Dimension[]) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

const DISCOVER_URL_PREFIX = "rag-eval:dimension-discover-url:";
const discoverUrlKey = (kbId: string) => `${DISCOVER_URL_PREFIX}${kbId}`;

export function WizardStepDimensions({ kbId, dimensions, onChange, onNext, onSkip, onBack }: WizardStepDimensionsProps) {
  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem(discoverUrlKey(kbId)) ?? ""; }
    catch { return ""; }
  });
  // ... rest of existing state
```

- [ ] **Step 3: Reload URL when kbId changes**

After the existing `useState` declarations, add:

```typescript
useEffect(() => {
  try {
    setUrl(localStorage.getItem(discoverUrlKey(kbId)) ?? "");
  } catch {
    setUrl("");
  }
}, [kbId]);
```

Add `useEffect` to the imports from React.

- [ ] **Step 4: Update the write inside `handleDiscover`**

Find the line `try { localStorage.setItem("rag-eval:dimension-discover-url", url); } catch {}` and replace with:

```typescript
try { localStorage.setItem(discoverUrlKey(kbId), url); } catch {}
```

- [ ] **Step 5: Pass `kbId` from `GenerationWizard` to `WizardStepDimensions`**

In `GenerationWizard.tsx`, find the `<WizardStepDimensions ... />` usage (around line 165). Add `kbId={kbId}` to the props:

```tsx
<WizardStepDimensions
  kbId={kbId}
  dimensions={config.dimensions}
  onChange={(dims) => setConfig((prev) => ({ ...prev, dimensions: dims }))}
  onNext={() => setStep(2)}
  onSkip={() => setStep(2)}
  onBack={() => setStep(0)}
/>
```

- [ ] **Step 6: Add migration for the discover URL global key in `GenerationWizard`**

Extend the existing migration `useEffect` added in Task 3 to also migrate the discover URL:

```typescript
const OLD_DISCOVER_URL_KEY = "rag-eval:dimension-discover-url";
const DISCOVER_URL_PREFIX = "rag-eval:dimension-discover-url:";
const discoverUrlKey = (kbId: string) => `${DISCOVER_URL_PREFIX}${kbId}`;
```

And inside the migration effect:

```typescript
useEffect(() => {
  try {
    // Migrate wizard config
    const oldConfig = localStorage.getItem(OLD_WIZARD_CONFIG_KEY);
    if (oldConfig != null) {
      const currentKey = wizardKey(kbId);
      if (localStorage.getItem(currentKey) == null) {
        localStorage.setItem(currentKey, oldConfig);
      }
      localStorage.removeItem(OLD_WIZARD_CONFIG_KEY);
    }
    // Migrate discover URL
    const oldUrl = localStorage.getItem(OLD_DISCOVER_URL_KEY);
    if (oldUrl != null) {
      const currentUrlKey = discoverUrlKey(kbId);
      if (localStorage.getItem(currentUrlKey) == null) {
        localStorage.setItem(currentUrlKey, oldUrl);
      }
      localStorage.removeItem(OLD_DISCOVER_URL_KEY);
    }
  } catch {
    // Silent — migration is best-effort
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Note: the constants `OLD_DISCOVER_URL_KEY`, `DISCOVER_URL_PREFIX`, and `discoverUrlKey` are duplicated between `GenerationWizard.tsx` (for migration) and `WizardStepDimensions.tsx` (for runtime). This duplication is intentional and acceptable — extracting them into a shared module would be over-engineering for two call sites.

- [ ] **Step 7: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds. If TypeScript complains about the missing `kbId` prop on `WizardStepDimensions`, verify step 5 was applied.

- [ ] **Step 8: Manual check**

1. In DevTools: `localStorage.setItem("rag-eval:dimension-discover-url", "https://example.com")`.
2. Reload the page, open the wizard, advance to step 2 (Dimensions). Verify the URL field shows `https://example.com`.
3. Verify old key is gone: `localStorage.getItem("rag-eval:dimension-discover-url")` → `null`.
4. Switch KBs. Verify the URL field resets (or shows a different URL if that KB has one).

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/components/GenerationWizard.tsx packages/frontend/src/components/WizardStepDimensions.tsx
git commit -m "feat(frontend): persist dimension discover URL per-KB

Each KB now remembers its own auto-discovery URL. Includes migration
from the old global localStorage key."
```

---

## Task 5: Restructure `GenerationWizard` container layout

**Files:**
- Modify: `packages/frontend/src/components/GenerationWizard.tsx`

This task replaces the sidebar-width layout with the full-width wizard card (header + stepper + content). It also adds the `onCancel` prop.

- [ ] **Step 1: Read the current JSX in GenerationWizard**

Read lines 134–197 of `GenerationWizard.tsx`. Note the current return JSX with the pill-button stepper.

- [ ] **Step 2: Add `onCancel` to `GenerationWizardProps`**

Add `onCancel: () => void;` to the `GenerationWizardProps` interface (around line 38):

```typescript
interface GenerationWizardProps {
  kbId: Id<"knowledgeBases">;
  documents: DocInfo[];
  generating: boolean;
  disabledReason?: string;
  onGenerated: (datasetId: Id<"datasets">, jobId: Id<"generationJobs">) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}
```

Destructure `onCancel` in the function signature:

```typescript
export function GenerationWizard({
  kbId,
  documents,
  generating,
  disabledReason,
  onGenerated,
  onError,
  onCancel,
}: GenerationWizardProps) {
```

- [ ] **Step 3: Replace the return JSX with the new layout**

Replace the entire `return (...)` block with:

```tsx
return (
  <div className="h-full overflow-y-auto p-6">
    <div className="max-w-[840px] mx-auto border border-border rounded-lg bg-bg-elevated p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
        <h2 className="text-sm font-semibold text-text">New Question Generation</h2>
        <button
          onClick={onCancel}
          className="text-xs text-text-dim hover:text-text transition-colors"
        >
          ✕ Cancel
        </button>
      </div>

      {/* Stepper */}
      <div className="flex items-stretch gap-2 mb-6">
        {STEPS.map((label, i) => {
          const state = i === step ? "active" : i < step ? "done" : "pending";
          return (
            <button
              key={label}
              onClick={() => setStep(i)}
              className="flex-1 flex flex-col items-stretch gap-1.5 group"
            >
              <div
                className={`h-[3px] rounded-sm transition-colors ${
                  state === "active"
                    ? "bg-accent"
                    : state === "done"
                      ? "bg-accent-dim"
                      : "bg-border group-hover:bg-border-bright"
                }`}
              />
              <span
                className={`text-[10px] text-center transition-colors ${
                  state === "active"
                    ? "text-accent"
                    : state === "done"
                      ? "text-accent"
                      : "text-text-dim"
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="min-h-[420px]">
        {step === 0 && (
          <WizardStepRealWorld
            questions={config.realWorldQuestions}
            onChange={(qs) => setConfig((prev) => ({ ...prev, realWorldQuestions: qs }))}
            onNext={() => setStep(1)}
            onSkip={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <WizardStepDimensions
            kbId={kbId}
            dimensions={config.dimensions}
            onChange={(dims) => setConfig((prev) => ({ ...prev, dimensions: dims }))}
            onNext={() => setStep(2)}
            onSkip={() => setStep(2)}
            onBack={() => setStep(0)}
          />
        )}
        {step === 2 && (
          <WizardStepPreferences
            preferences={config.preferences}
            onChange={(prefs) => setConfig((prev) => ({ ...prev, preferences: prefs }))}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <WizardStepReview
            config={config}
            documents={docsWithPriority}
            onTotalQuestionsChange={(n) => setConfig((prev) => ({ ...prev, totalQuestions: n }))}
            onPriorityChange={handlePriorityChange}
            onGenerate={handleGenerate}
            onBack={() => setStep(2)}
            onEditStep={(s) => setStep(s)}
            generating={generating}
            disabled={!documents.length}
            disabledReason={disabledReason}
          />
        )}
      </div>
    </div>
  </div>
);
```

Note that `kbId` is now a `string` (Convex ID) being passed to `WizardStepDimensions`. Pass it as `kbId={kbId as string}` only if TypeScript complains — the prop type in `WizardStepDimensions` should accept `string`, and `Id<"knowledgeBases">` is a branded string so it should satisfy `string` automatically.

- [ ] **Step 4: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build fails with an error that `onCancel` is missing from the `<GenerationWizard>` usage in `page.tsx`. That's expected — Task 6 provides the callback.

If other errors appear (e.g., `WizardStepDimensions` still missing the `kbId` prop or `kbId` type mismatch), those indicate a problem with this task — fix before proceeding.

- [ ] **Step 5: Do NOT commit yet**

Task 5 and Task 6 are tightly coupled (component signature changed, parent must pass the new prop). Commit both together in Task 6.

---

## Task 6: Render wizard in main pane + sidebar button

**Files:**
- Modify: `packages/frontend/src/app/generate/page.tsx`

This task adds the `+ New Generation` button above the dataset list and moves the wizard rendering from the sidebar to the main pane. Must be done together with Task 5 for the TypeScript build to succeed.

- [ ] **Step 1: Read the current `/generate/page.tsx` JSX**

Read `packages/frontend/src/app/generate/page.tsx` lines 265–425. Note:
- Lines 267–405: sidebar (`w-[360px]`). Current wizard lives here inside `hasDocuments && mode === "generate"` block (lines 365–391).
- Lines 407–419: center question list pane.
- Lines 421–424: right doc viewer pane.
- Lines 280–307: datasets section with the current "View Datasets" / "+ New Dataset" toggle button in the datasets header.

- [ ] **Step 2: Remove the existing wizard block from the sidebar**

Delete lines 365–391 (the `{hasDocuments && mode === "generate" && ( ... <GenerationWizard /> ... )}` block). This moves the wizard out of the sidebar entirely.

- [ ] **Step 3: Add the `+ New Generation` button above the datasets list**

Find the `Datasets` section in the sidebar (around lines 280–307). Just **before** the `{selectedKbId && kbDatasets !== undefined && ( ... )}` block, insert a new section that shows the `+ New Generation` button:

```tsx
{/* + New Generation button */}
{selectedKbId && (
  <div className="border border-border rounded-lg bg-bg">
    <div className="p-3">
      <button
        onClick={() => {
          // Clear stale job state so the auto-switch-to-browse effect doesn't fire
          setDatasetId(null);
          setJobId(null);
          setMode("generate");
          setBrowseDatasetId(null);
          setSelectedQuestion(null);
          setSelectedDocId(null);
        }}
        disabled={!hasDocuments || !!activeJob}
        title={
          !hasDocuments
            ? "Upload documents before generating"
            : activeJob
              ? "Only one generation at a time"
              : undefined
        }
        className={`w-full px-3 py-2 text-xs rounded transition-colors ${
          mode === "generate"
            ? "bg-accent text-bg font-medium"
            : "border border-dashed border-accent/40 text-accent hover:bg-accent/5"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {mode === "generate" ? "● Creating new generation" : "+ New Generation"}
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Remove the old toggle button from the datasets section header**

Inside the datasets section (now below the new button), simplify the header by removing the old toggle button:

Find:

```tsx
<div className="px-4 py-2 border-b border-border flex items-center justify-between">
  <span className="text-xs text-text-dim uppercase tracking-wider">
    Datasets ({kbDatasets.length})
  </span>
  {kbDatasets.length > 0 && (
    <button ... >
      {mode === "generate" ? "View Datasets" : "+ New Dataset"}
    </button>
  )}
</div>
```

Replace with:

```tsx
<div className="px-4 py-2 border-b border-border">
  <span className="text-xs text-text-dim uppercase tracking-wider">
    Datasets ({kbDatasets.length})
  </span>
</div>
```

The dataset list body (the `{mode === "browse" && kbDatasets.length > 0 && ( ... )}` block) stays as-is, but change the condition from `mode === "browse"` to always render the list (since the sidebar list should be visible in both modes). Change:

```tsx
{mode === "browse" && kbDatasets.length > 0 && (
  <div className="p-4 space-y-1 max-h-64 overflow-y-auto">
```

to:

```tsx
{kbDatasets.length > 0 && (
  <div className="p-4 space-y-1 max-h-64 overflow-y-auto">
```

Also add an empty-state message for when the KB has zero datasets (matches the spec's "No datasets yet" requirement). Immediately after the existing dataset list block's closing `)}`, add:

```tsx
{kbDatasets.length === 0 && (
  <div className="p-4 text-xs text-text-dim">No datasets yet</div>
)}
```

In the dataset item click handler, ensure clicking a dataset switches back to `browse` mode (current code only calls `setBrowseDatasetId` — add `setMode("browse")`):

Find:

```tsx
onClick={() => {
  setBrowseDatasetId(ds._id);
  setSelectedQuestion(null);
  setSelectedDocId(null);
}}
```

Replace with:

```tsx
onClick={() => {
  setBrowseDatasetId(ds._id);
  setSelectedQuestion(null);
  setSelectedDocId(null);
  setMode("browse");
}}
```

- [ ] **Step 5: Add `handleCancelGeneration` near `handleReset`**

Find the existing `function handleReset()` (around line 165). Add a new function below it:

```typescript
function handleCancelGeneration() {
  // Return to browse mode, preserving the currently-selected dataset if any.
  // If no dataset is selected but datasets exist, select the first one.
  setMode("browse");
  if (!browseDatasetId && kbDatasets && kbDatasets.length > 0) {
    setBrowseDatasetId(kbDatasets[0]._id);
  }
}
```

- [ ] **Step 6: Render the wizard in the main pane when `mode === "generate"`**

Find the existing main-pane JSX (lines 407–424):

```tsx
{/* Center: question list */}
{(displayQuestions.length > 0 || displayGenerating) && (
  <div className="w-80 flex-shrink-0 border-r border-border bg-bg">
    <QuestionList ... />
  </div>
)}

{/* Right: document viewer */}
<div className="flex-1 min-w-0 bg-bg overflow-hidden">
  <DocumentViewer doc={selectedDoc} question={selectedQ} />
</div>
```

Wrap this in a conditional so it only renders in `browse` mode, and add a new branch for `generate` mode rendering the wizard:

```tsx
{mode === "generate" ? (
  <div className="flex-1 min-w-0 bg-bg overflow-hidden">
    <GenerationWizard
      kbId={selectedKbId!}
      documents={(documentsData ?? []).map((d) => ({
        _id: d._id as string,
        docId: d.docId,
        title: d.title,
        priority: d.priority ?? 3,
      }))}
      generating={generating}
      disabledReason={activeJob ? "Only one generation at a time" : undefined}
      onGenerated={(dsId, jId) => {
        setDatasetId(dsId);
        setJobId(jId);
        setBrowseDatasetId(dsId);
        setMode("browse");
      }}
      onError={setGenError}
      onCancel={handleCancelGeneration}
    />
  </div>
) : (
  <>
    {/* Center: question list */}
    {(displayQuestions.length > 0 || displayGenerating) && (
      <div className="w-80 flex-shrink-0 border-r border-border bg-bg">
        <QuestionList
          questions={displayQuestions}
          selectedIndex={selectedQuestion}
          onSelect={setSelectedQuestion}
          generating={displayGenerating}
          totalDone={displayTotalDone}
          phaseStatus={displayPhaseStatus}
        />
      </div>
    )}

    {/* Right: document viewer */}
    <div className="flex-1 min-w-0 bg-bg overflow-hidden">
      <DocumentViewer doc={selectedDoc} question={selectedQ} />
    </div>
  </>
)}
```

- [ ] **Step 7: Verify `selectedKbId!` assertion is safe**

The wizard-render branch uses `kbId={selectedKbId!}`. This is safe because the `+ New Generation` button is wrapped in `{selectedKbId && ...}` — users cannot enter `generate` mode without a selected KB. If TypeScript still complains, add an early `if (!selectedKbId) return null;` guard inside the generate branch.

- [ ] **Step 8: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 9: Manual check**

Start the dev stack. Navigate to `/generate`:

1. Select a KB with documents. Verify the sidebar shows `+ New Generation` as a dashed outline button above the datasets section.
2. Click `+ New Generation`. Verify:
   - Main pane swaps from question list + doc viewer to a centered wizard card.
   - Sidebar button becomes filled accent background with `● Creating new generation` label.
   - Wizard shows step 1 (Real-World Questions) in a roomy card.
3. Advance through the steps. Check the stepper bars update as you advance.
4. Click `✕ Cancel` in the wizard header. Verify:
   - Main pane returns to question list + doc viewer.
   - Sidebar button returns to dashed outline.
5. Click `+ New Generation` again. Verify config state is preserved (the steps you filled in are still there).
6. Click an existing dataset in the sidebar. Verify the page returns to browse mode showing that dataset's questions.
7. With a KB that has no documents, verify the button is disabled with the tooltip.
8. Trigger a generation, wait for the activeJob banner, click `+ New Generation` while the banner is visible. The button should be disabled with the "Only one generation at a time" tooltip.

- [ ] **Step 10: Commit**

```bash
git add packages/frontend/src/components/GenerationWizard.tsx packages/frontend/src/app/generate/page.tsx
git commit -m "feat(frontend): render generation wizard in main pane

Moves the wizard out of the 360px sidebar into the main content area
as a full-width card. Adds a + New Generation button above the dataset
list and a Cancel button on the wizard header. Mode-switching reuses
the existing browse/generate state — no new top-level state."
```

---

## Task 7: Refine `WizardStepRealWorld` for wider layout

**Files:**
- Modify: `packages/frontend/src/components/WizardStepRealWorld.tsx`

- [ ] **Step 1: Read current JSX**

Read the full file (63 lines). Note the textarea is `h-40` (160px) and the counter sits in the header above it.

- [ ] **Step 2: Grow the textarea and move counter below**

Change the textarea className from `h-40` to `min-h-[200px]`:

```tsx
<textarea
  value={text}
  onChange={(e) => handleChange(e.target.value)}
  placeholder="How do I reset my API key?&#10;What's the rate limit on the free plan?&#10;Can I upgrade mid-billing cycle?"
  className="w-full min-h-[200px] bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-text font-mono resize-y focus:outline-none focus:border-accent-dim"
/>
```

Note: also changed `resize-none` to `resize-y` so users can manually enlarge the textarea if needed, and fixed the placeholder to use `&#10;` (HTML entity for newline) instead of `\n` for proper display.

Remove the counter badge from the header section. Change:

```tsx
<div>
  <div className="flex items-center justify-between mb-2">
    <span className="text-xs text-text-dim uppercase tracking-wider">Real-World Questions</span>
    {count > 0 && (
      <span className="text-xs px-2 py-0.5 rounded-full bg-accent-dim text-accent-bright">
        {count} question{count !== 1 ? "s" : ""}
      </span>
    )}
  </div>
  <p className="text-xs text-text-dim mb-3">
    Paste real questions from your users (one per line). These help generate more realistic evaluation questions.
  </p>
</div>
```

to:

```tsx
<div>
  <span className="text-xs text-text-dim uppercase tracking-wider">Real-World Questions</span>
  <p className="text-xs text-text-dim mt-1">
    Paste real questions from your users (one per line). These help generate more realistic evaluation questions.
  </p>
</div>
```

Add the counter below the textarea:

```tsx
<textarea ... />

{count > 0 && (
  <p className="text-xs text-accent">
    {count} question{count !== 1 ? "s" : ""} · will be matched to documents during generation
  </p>
)}
```

- [ ] **Step 3: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 4: Manual check**

Open the wizard → step 1. Verify:
- Textarea is visibly taller.
- Counter appears below the textarea when questions are entered.
- Counter disappears when textarea is cleared.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/WizardStepRealWorld.tsx
git commit -m "feat(frontend): enlarge real-world questions textarea

Textarea now has min-h-[200px] and is vertically resizable. Counter
moves below the textarea for better balance in the new wider layout."
```

---

## Task 8: Refine `WizardStepDimensions` for wider layout

**Files:**
- Modify: `packages/frontend/src/components/WizardStepDimensions.tsx`

- [ ] **Step 1: Switch dimension cards to a responsive grid**

Find the dimension list block (lines 85–104):

```tsx
{dimensions.length > 0 && (
  <div className="space-y-2">
    {dimensions.map((dim, di) => (
      <div key={di} className="p-2 border border-border rounded">
        ...
      </div>
    ))}
  </div>
)}
```

Replace with:

```tsx
{dimensions.length > 0 && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {dimensions.map((dim, di) => (
      <div key={di} className="p-3 border border-border rounded">
        ...
      </div>
    ))}
  </div>
)}
```

The only change is `space-y-2` → `grid grid-cols-1 md:grid-cols-2 gap-3`, and `p-2` → `p-3` on each card for a little more breathing room.

- [ ] **Step 2: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 3: Manual check**

Open the wizard → step 2. Add a few dimensions manually or via auto-discover. Verify:
- At viewport width ≥ 768px (md): dimensions render in a 2-column grid.
- At narrower viewports: dimensions stack in a single column.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/WizardStepDimensions.tsx
git commit -m "feat(frontend): 2-column dimension grid in wizard step 2

Dimension cards now render in a responsive 2-column grid at md:
breakpoint. Single column at narrower viewports."
```

---

## Task 9: Refine `WizardStepPreferences` for wider layout

**Files:**
- Modify: `packages/frontend/src/components/WizardStepPreferences.tsx`

- [ ] **Step 1: Switch tone + question types to 2-column, keep focus areas full-width**

Find the body JSX (lines 23–74). Wrap the question-types and tone blocks in a 2-column grid, leaving focus areas as a full-row element below:

```tsx
<div className="space-y-4 animate-fade-in">
  <div>
    <span className="text-xs text-text-dim uppercase tracking-wider">Generation Preferences</span>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {/* Question types */}
    <div>
      <label className="text-xs text-text-dim mb-1.5 block">Question Types</label>
      <div className="flex flex-wrap gap-1.5">
        {QUESTION_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => toggleType(type)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              preferences.questionTypes.includes(type)
                ? "border-accent bg-accent-dim text-accent-bright"
                : "border-border text-text-dim hover:border-border-bright"
            }`}
          >
            {type}
          </button>
        ))}
      </div>
    </div>

    {/* Tone */}
    <div>
      <label className="text-xs text-text-dim mb-1.5 block">Tone</label>
      <select
        value={preferences.tone}
        onChange={(e) => onChange({ ...preferences, tone: e.target.value })}
        className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent-dim"
      >
        {TONES.map((tone) => (
          <option key={tone} value={tone}>{tone}</option>
        ))}
      </select>
    </div>
  </div>

  {/* Focus areas — full row */}
  <div>
    <label className="text-xs text-text-dim mb-1.5 block">Focus Areas</label>
    <input
      type="text"
      value={preferences.focusAreas}
      onChange={(e) => onChange({ ...preferences, focusAreas: e.target.value })}
      placeholder="e.g., API integration, authentication, billing"
      className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent-dim"
    />
  </div>

  <div className="flex justify-between">
    <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors">← Back</button>
    <button onClick={onNext} className="px-3 py-1.5 text-xs rounded bg-accent-dim text-accent-bright hover:bg-accent/20 transition-colors">Next →</button>
  </div>
</div>
```

- [ ] **Step 2: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 3: Manual check**

Open the wizard → step 3. Verify at md viewport: question types (left) and tone dropdown (right) are side-by-side. Focus areas input spans the full row below.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/WizardStepPreferences.tsx
git commit -m "feat(frontend): 2-column layout for preferences step

Question types and tone dropdown are side-by-side at md breakpoint,
focus areas input keeps a full-row below them."
```

---

## Task 10: Refine `WizardStepReview` priority table scroll + sticky header

**Files:**
- Modify: `packages/frontend/src/components/WizardStepReview.tsx`

- [ ] **Step 1: Read the current table JSX**

Read lines 80–111 of `WizardStepReview.tsx`. Note the current structure: `<div className="border border-border rounded overflow-hidden"><table>...</table></div>`.

- [ ] **Step 2: Add scroll container and sticky thead**

Change the outer wrapper from `overflow-hidden` to a vertically scrollable container with max height:

```tsx
<div className="border border-border rounded max-h-[360px] overflow-y-auto">
  <table className="w-full text-xs">
    <thead className="sticky top-0 bg-bg-secondary z-10">
      <tr>
        <th className="text-left px-3 py-1.5 text-text-dim font-normal">Document</th>
        <th className="text-center px-3 py-1.5 text-text-dim font-normal w-24">Priority</th>
        <th className="text-right px-3 py-1.5 text-text-dim font-normal w-16">Alloc.</th>
      </tr>
    </thead>
    <tbody>
      {/* existing rows unchanged */}
    </tbody>
  </table>
</div>
```

The key changes:
- `overflow-hidden` → `max-h-[360px] overflow-y-auto` on the outer div
- `<thead>` gets `sticky top-0 bg-bg-secondary z-10` so the headers stay visible while scrolling
- Remove the `bg-bg-secondary` class from the `<tr>` inside `<thead>` since it's now on the `<thead>` itself

- [ ] **Step 3: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 4: Manual check**

Open the wizard → step 4. If the current KB has more than ~10 documents, verify:
- Table scrolls vertically when there are enough rows.
- Column headers remain visible at the top while scrolling.
- Priority dots remain clickable inside the scroll container.

If the KB has only a few documents, add more to a test KB or temporarily set `max-h-[120px]` to see the scroll behavior. Restore `max-h-[360px]` before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/WizardStepReview.tsx
git commit -m "feat(frontend): sticky header + scroll for review priority table

Priority table now scrolls vertically with a sticky header when there
are many documents. Max height 360px keeps the summary + slider +
buttons in view without jumping."
```

---

## Task 11: End-to-end manual verification

**Files:** None modified — verification only.

- [ ] **Step 1: Full TypeScript build**

Run: `pnpm -C packages/frontend build`
Expected: Succeeds with no errors.

- [ ] **Step 2: Backend tests**

Run: `pnpm -C packages/backend test`
Expected: All tests pass.

- [ ] **Step 3: End-to-end manual walkthrough**

Start the dev stack and walk through the full checklist from the spec's Testing section. Any failures are regressions that must be fixed before the branch is ready for review.

1. Open `/generate`, select a KB with documents. Sidebar shows `+ New Generation` as a dashed button above datasets.
2. Click `+ New Generation`. Main pane shows wizard card; sidebar button is filled accent.
3. Step 1 (Real-World): textarea is tall, counter appears below.
4. Step 2 (Dimensions): dimensions render in 2-column grid at wide viewports; auto-discover URL persists per-KB.
5. Step 3 (Preferences): question types + tone side-by-side, focus areas full-width.
6. Step 4 (Review): summary cards, slider, priority table scrolls with sticky header. Priority dots change and persist across reload.
7. `✕ Cancel` returns to browse mode, sidebar button returns to dashed.
8. Config persistence across KB switches works and is per-KB.
9. Migration from old global keys works (manually seed in DevTools).
10. Generation flow still works end-to-end — start a generation, verify job banner, verify browse mode after completion.

- [ ] **Step 4: Verify commit history is clean**

Run: `git log --oneline origin/main..HEAD`
Expected: ~7 commits (tasks 1–10), each with a clear fix/feat prefix and concise message.

- [ ] **Step 5: No commit for this task**

Task 11 is verification only — no files modified, no commit needed.

---

## Summary

| Task | Files | Lines of change (approx) |
|------|-------|--------------------------|
| 1. Backend listByKb priority | `documents.ts` | +1 |
| 2. page.tsx priority fix | `page.tsx` | ~3 |
| 3. Per-KB wizard config + migration | `GenerationWizard.tsx` | ~40 |
| 4. Per-KB discover URL | `GenerationWizard.tsx`, `WizardStepDimensions.tsx` | ~30 |
| 5. Wizard container restructure | `GenerationWizard.tsx` | ~80 |
| 6. Main pane rendering + sidebar button | `page.tsx` | ~60 |
| 7. Real-world textarea | `WizardStepRealWorld.tsx` | ~15 |
| 8. Dimensions grid | `WizardStepDimensions.tsx` | ~3 |
| 9. Preferences grid | `WizardStepPreferences.tsx` | ~20 |
| 10. Review sticky thead | `WizardStepReview.tsx` | ~5 |
| 11. End-to-end verification | (none) | 0 |

Total: ~7 commits, ~260 lines touched across 7 files. No new files created, no files deleted.
