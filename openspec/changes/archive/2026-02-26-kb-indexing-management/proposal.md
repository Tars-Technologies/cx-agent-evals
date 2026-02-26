## Why

The current system tightly couples KB indexing with experiment execution — indexing only happens as step 1 of running an experiment. This prevents using the retriever for production inference (agents, tools), forces re-indexing configuration every time an experiment runs, and makes it impossible to manage, inspect, or clean up indexed data independently. Separating retriever setup from experiment evaluation enables both production use and cleaner experimentation workflows.

## What Changes

- **New `retrievers` table** in Convex schema to store retriever configurations as first-class entities (KB + full pipeline config + status + both index and retriever config hashes)
- **New Retrievers page** (`/retrievers`) in the frontend for creating, managing, and testing retrievers independently of experiments
- **Retriever playground** within the Retrievers page — query one or more "ready" retrievers side-by-side and compare results
- **New `retrieve` action** in the backend — standalone retrieval endpoint usable by the playground, experiments, and future production consumers
- **New backend CRUD** for retrievers — create (configuring state), start indexing (separate action), list, delete (cascades to index), delete index, cancel indexing
- **Simplified Experiments page** — select an existing "ready" retriever + dataset instead of configuring pipeline inline; no more indexing phase card
- **`k` moves into retriever config** — becomes part of the pipeline config and affects `retrieverConfigHash`, ensuring consistent behavior per retriever
- Retriever dedup by `(kbId, retrieverConfigHash)` — prevents duplicate retrievers with identical configs
- Experiments table gains optional `retrieverId` field; legacy experiments retain inline `retrieverConfig`

## Capabilities

### New Capabilities
- `retriever-management`: CRUD operations for retriever entities — create (configuring state), start indexing (separate action), list by KB, delete (cascades to index), delete index, cancel indexing, reset after cancel. Backend table, mutations, queries, actions.
- `retriever-playground`: Frontend UI for querying one or more ready retrievers side-by-side on a KB, comparing ranked results with scores and latency.
- `retrieve-action`: Standalone backend action that takes a retriever ID + query and returns ranked chunks — the production-ready retrieval endpoint.
- `retrievers-ui`: Frontend Retrievers page — KB selection, pipeline config, retriever list with status/progress, and integrated playground.

### Modified Capabilities
- `experiments-ui`: Experiments page simplified — replaces inline pipeline config with retriever selector dropdown, removes indexing phase card, experiment start sends `retrieverId` instead of `retrieverConfig`.
- `convex-experiment-runner`: `experiments.start` mutation accepts `retrieverId`; `runExperiment` action loads config from retrievers table and skips indexing orchestration.
- `mode-selector-ui`: Home page adds third "Retrievers" card, grid changes from 2-col to 3-col.
- `convex-schema`: Add `retrievers` table, add optional `retrieverId` to `experiments` table.

## Impact

- **Backend (Convex)**: New `retrievers` table + schema migration. New files: `retrievers.ts` (CRUD mutations/queries), `retrieverActions.ts` (create, startIndexing, retrieve actions — "use node" file). Modified: `experiments.ts`, `experimentActions.ts`, `schema.ts`.
- **Frontend**: New route `/retrievers` with new page + components (`RetrieverCard`, `RetrieverPlayground`, `RetrieverSelector`). Modified: `ModeSelector.tsx`, experiments page (major simplification), `pipeline-types.ts` (k into config), `Header.tsx`.
- **Existing data**: No breaking migration — existing experiments keep inline `retrieverConfig`; new experiments use `retrieverId`. Existing `documentChunks` and `indexingJobs` tables are unchanged.
- **API surface**: New public Convex mutations/queries for retriever CRUD. New action for retrieval. Existing experiment API gets optional `retrieverId` field.
