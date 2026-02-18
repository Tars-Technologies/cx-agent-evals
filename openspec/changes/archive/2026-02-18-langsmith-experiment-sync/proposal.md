## Why

Experiments run on Convex complete fast but never appear in LangSmith's experiment UI. The current `syncExperiment` creates orphaned runs via `client.createRun()` instead of using LangSmith's `evaluate()` API, so experiments aren't linked to datasets, scores aren't recorded as evaluator feedback, and comparison/analytics features don't work. The old Next.js approach used `evaluate()` directly and everything worked — the Convex migration broke this integration.

## What Changes

- **Add `CallbackRetriever` to eval-lib**: A `Retriever` implementation that delegates to user-provided callback functions, enabling Convex (or any external system) to plug in its own vector search without eval-lib knowing about the backing store.
- **Add `onResult` callback to `runLangSmithExperiment()`**: Fires after each question is evaluated with the retrieved spans and scores, allowing the caller to persist results (e.g., write to Convex `experimentResults` table) as a side effect during the experiment run.
- **Rewrite Convex experiment pipeline**: Replace the 3-phase Convex-only evaluation (indexing → evaluation → aggregation) + broken LangSmith sync with a single action that uses `runLangSmithExperiment()` with a `CallbackRetriever` backed by Convex vector search. Results are written to both LangSmith and Convex in one pass.
- **Remove broken `syncExperiment`**: Delete the orphaned-run-based sync from `langsmithSync.ts`.

## Capabilities

### New Capabilities
- `callback-retriever`: A generic `Retriever` implementation in eval-lib that wraps user-provided `retrieveFn`, `initFn`, and `cleanupFn` callbacks, decoupling retrieval logic from storage backend.

### Modified Capabilities
- `langsmith-experiment-runner`: Add `onResult` callback option to `runLangSmithExperiment()` so callers can capture per-question results during the experiment run.
- `convex-experiment-runner`: Replace the internal 3-phase evaluation pipeline with a single action that delegates to eval-lib's `runLangSmithExperiment()` using a `CallbackRetriever`. Results stream to both LangSmith and Convex simultaneously.
- `convex-langsmith-sync`: Remove the broken `syncExperiment` action. Dataset sync remains unchanged.

## Impact

- **eval-lib**: New `CallbackRetriever` class exported from `experiments/`. Extended `LangSmithExperimentConfig` interface with `onResult` callback.
- **backend**: `experimentActions.ts` rewritten — 3 phases (indexing, evaluation, aggregation) collapse into 1 action. `langsmithSync.ts` loses `syncExperiment` and `syncDatasetDirect`. Job pipeline simplified.
- **frontend**: No changes — the experiments page already watches job/experiment status reactively.
- **Dependencies**: `langsmith` package must be available in the Convex Node.js runtime (already a peer dependency of eval-lib).
