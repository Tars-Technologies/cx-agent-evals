## 1. eval-lib: CallbackRetriever

- [x] 1.1 Create `CallbackRetriever` class in `packages/eval-lib/src/experiments/callback-retriever.ts` implementing the `Retriever` interface with `retrieveFn`, optional `initFn`, and optional `cleanupFn` callbacks
- [x] 1.2 Export `CallbackRetriever` and `CallbackRetrieverConfig` from `src/experiments/index.ts` and `src/index.ts`
- [x] 1.3 Build eval-lib (`pnpm build`) and verify no type errors

## 2. eval-lib: onResult callback in runLangSmithExperiment

- [x] 2.1 Add `onResult` callback and `ExperimentResult` type to `LangSmithExperimentConfig` in `packages/eval-lib/src/langsmith/experiment-runner.ts`
- [x] 2.2 Modify `runLangSmithExperiment()` to create a custom evaluator wrapper that computes all metrics and calls `onResult` with query, retrievedSpans, and scores for each evaluated question
- [x] 2.3 Export `ExperimentResult` type from `src/index.ts`
- [x] 2.4 Build eval-lib and run tests to verify no regressions

## 3. Backend: Add langsmith dependency

- [x] 3.1 Add `langsmith` package to `packages/backend/package.json` dependencies
- [x] 3.2 Run `pnpm install` to update lockfile

## 4. Backend: Rewrite experiment pipeline

- [x] 4.1 Rewrite `experimentActions.ts` — replace the 3-phase pipeline (`runIndexing`, `runEvaluation`, `runAggregation`) with a single `runExperiment` action that: checks/runs indexing, ensures dataset is synced to LangSmith, creates a `CallbackRetriever` backed by Convex vector search, loads corpus via `createCorpusFromDocuments()`, and calls `runLangSmithExperiment()` with `onResult` callback that writes to `experimentResults`
- [x] 4.2 Update `experiments.start` mutation to schedule `internal.experimentActions.runExperiment` instead of `runIndexing`
- [x] 4.3 Add aggregation logic after `runLangSmithExperiment()` completes — compute average scores and update experiment status

## 5. Backend: Clean up broken sync

- [x] 5.1 Remove `syncExperiment` action and `syncDatasetDirect` helper from `langsmithSync.ts`
- [x] 5.2 Remove `retryExperimentSync` mutation from `langsmithRetry.ts` (if it exists)
- [x] 5.3 Remove the fire-and-forget `syncExperiment` schedule from the old aggregation phase (now deleted)

## 6. Verification

- [x] 6.1 Build eval-lib (`pnpm build`) — verify clean build
- [x] 6.2 Run eval-lib tests (`pnpm test`) — verify no regressions (3 pre-existing dimension test failures unrelated)
- [x] 6.3 Deploy Convex functions (`pnpm dev:backend` or `npx convex dev --once`) — verify schema/function deployment succeeds
- [x] 6.4 Typecheck backend (`pnpm typecheck:backend`) — verify no type errors
