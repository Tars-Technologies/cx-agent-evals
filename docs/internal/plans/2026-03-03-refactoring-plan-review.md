# Refactoring Plan Review — Corrections Applied

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply verified corrections to `packages/backend/docs/refactoring-suggestions.md` based on deep codebase validation.

**Architecture:** Documentation-only changes — no code modifications. Each task is a specific correction to the refactoring plan, validated against the actual codebase.

**Tech Stack:** Markdown documentation

---

## Summary of Changes Applied

All corrections have been applied directly to `refactoring-suggestions.md` in a single pass. Here is what was changed and why:

### Critical Fixes (Would Have Caused Breakage)

| # | Issue | Fix Applied |
|---|---|---|
| 1 | **Sub-path isolation constraint missing** — Moving LangSmith/OpenAI code to eval-lib creates a risk: mutation/query files (V8 isolate) must never import from the new sub-paths | Added "Critical Constraint: Sub-Path Isolation" section in §2 with explicit rules and rationale |
| 2 | **Section 10.4 wrong** — Plan recommended adding `"use node"` to `langsmithSyncRetry.ts`, which would break its `internalQuery` export | Rewrote §10.4 to explain the file works correctly as-is; the action uses only Convex runtime calls |
| 3 | **Relative import paths not mentioned** — 13 files import `./lib/auth` etc.; moving them to subdirs breaks these paths | Added "Relative Import Paths" note in §3 and a Phase 3 roadmap step |

### Factual Corrections

| # | Issue | Fix Applied |
|---|---|---|
| 4 | **JobStatus: 2 files, not 3** — `experiments.ts` has no `JobStatus` type | Fixed §5.3 to say 2 copies (generation.ts, indexing.ts) |
| 5 | **applyResult/counterPatch: generation.ts only** — indexing.ts uses inline logic, not named helpers | Rewrote §5.4 to accurately describe both patterns |
| 6 | **Internal ref count: 72, not ~100+** | Changed to "~70 call-site references across 12 files" in §3 and Phase 3 |

### Completeness Improvements

| # | Issue | Fix Applied |
|---|---|---|
| 7 | **API path table incomplete** — Only covered ~35 of ~50 unique internal paths | Expanded table to complete list with call-site counts, organized by domain |
| 8 | **minisearch removal unsafe** — Used by eval-lib's BM25 search; must stay in convex.json | Rewrote §8 minisearch item; fixed Phase 1 roadmap to only remove from package.json |
| 9 | **openai dependency status unclear** — Optional in eval-lib, but createEmbedder() needs it | Added "Dependency Notes" subsection in §2 |
| 10 | **eval-lib import surface outdated** — Didn't reflect new sub-paths | Rewrote §8 import surface as a table with "used by" constraints |

### No Changes Needed

- **Frontend changes doc** — All 26 references, 7 files, line numbers verified 100% correct
- **All dead code claims** — Verified correct (ragActions.ts, rag.insertChunk, rag.deleteKbChunks, testing.ts, MAX_AUTO_RETRIES)
- **All line count claims** — experimentActions.ts lines 28-154, langsmithSync.ts lines 15-102, lib/llm.ts 20 lines, lib/langsmith.ts 4 lines — all correct

---

## Second Review Pass

A follow-up review found 4 additional issues — all clarity/correctness fixes, none critical:

| # | Issue | Fix Applied |
|---|---|---|
| 11 | **Wrong import in sample code** — §2 sample imported `createEmbedder` from `rag-evaluation-system/langsmith` but it lives in `/llm` | Split import: `runLangSmithExperiment` from `/langsmith`, `createEmbedder` from `/llm` |
| 12 | **Package.json exports oversimplified** — Example showed flat strings, but eval-lib uses conditional exports (`types`/`import`/`require`). Didn't mention preserving existing sub-paths. | Rewrote to show conditional exports pattern with note to preserve existing sub-paths |
| 13 | **"Zero mutation files import from it" becomes incorrect after Phase 2** — Mutation files will import `JobStatus` from `rag-evaluation-system/shared` | Clarified the invariant applies to `/langsmith` and `/llm` only; `/shared` is safe for any file |
| 14 | **Vector search helper location ambiguous** — §5.6 said `convex/retrieval/` but used by experiments too | Changed to `lib/vectorSearch.ts` with rationale for neutral location |

---

## Verification

The changes are documentation-only. To verify:

```bash
# Confirm no code files were modified
git diff --stat  # Should show only .md files
```
