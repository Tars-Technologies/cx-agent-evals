## Why

The backend uses two different job execution architectures: a custom `jobs`/`jobItems`/`batchProcessor` system for question generation, and a monolithic single-action runner for experiments. Meanwhile, KB indexing already uses the cleaner WorkPool component pattern. Unifying all three onto WorkPool eliminates custom batch processing code, adds automatic retry with exponential backoff, enables per-item parallelism, and makes all long-running operations follow the same readable pattern: tracking table → start mutation → enqueue → per-item action → onComplete → finalize.

## What Changes

- Register two new WorkPool instances (`generationPool`, `experimentPool`) alongside existing `indexingPool`
- **BREAKING**: Replace `jobs` and `jobItems` tables with a dedicated `generationJobs` table (mirrors `indexingJobs` pattern)
- Rewrite question generation as a two-phase WorkPool flow: Phase 1 fans out generation actions, Phase 2 fans out ground truth assignment actions
- Rewrite experiment execution to run LangSmith's `evaluate()` as a single WorkPool item (no retry), with an orchestrator action for setup (indexing + LangSmith sync)
- Add progress tracking fields directly on the `experiments` table (no separate job record)
- **BREAKING**: Delete `jobs.ts`, `jobItems.ts`, `lib/batchProcessor.ts`, and watchdog/cron logic

## Capabilities

### New Capabilities
- `workpool-generation`: WorkPool-based question generation with two-phase fan-out (generate → ground truth)
- `workpool-experiment`: WorkPool-based experiment execution wrapping LangSmith's `evaluate()` as a single item for tracking and cancellation
- `langsmith-raw-api`: Raw LangSmith API helpers for creating experiments and logging results (available in eval-lib for standalone use)

### Modified Capabilities
- `kb-indexing-workpool-config`: Adding `generationPool` and `experimentPool` to the same WorkPool component configuration
- `convex-schema`: Replacing `jobs`/`jobItems` tables with `generationJobs`, adding progress fields to `experiments`

## Impact

- **Backend**: `convex.config.ts`, `schema.ts`, `generation.ts`, `generationActions.ts`, `experimentActions.ts`, `experiments.ts` all change significantly
- **Deleted files**: `jobs.ts`, `jobItems.ts`, `lib/batchProcessor.ts`
- **eval-lib**: New LangSmith raw API helpers in `src/langsmith/`
- **Frontend**: Components referencing `jobs` queries need to switch to `generationJobs` or `experiments` queries
- **Crons**: Remove job watchdog cron; WorkPool handles retry internally
