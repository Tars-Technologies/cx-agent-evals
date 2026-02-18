# CLAUDE.md

## Project overview

RAG Evaluation System — a TypeScript library + Convex backend + Next.js frontend for evaluating RAG retrieval pipelines. Uses span-based (character-level) evaluation with character span matching for precise retrieval assessment, synthetic question generation, and LangSmith integration for experiment tracking and comparison.

## Repository structure

This is a **pnpm workspace monorepo** with three packages:

```
packages/
  eval-lib/                     # Core library (TypeScript, published as rag-evaluation-system)
    src/
      types/                    # Branded types, primitives, document/corpus interfaces
      chunkers/                 # Chunker interface + RecursiveCharacterChunker
      embedders/                # Embedder interface (OpenAI implementation at embedders/openai)
      vector-stores/            # VectorStore interface (InMemory, Chroma at vector-stores/chroma)
      rerankers/                # Reranker interface (Cohere at rerankers/cohere)
      evaluation/               # Evaluation orchestrator and metrics (recall, precision, IoU, F1)
      synthetic-datagen/        # Synthetic question generation
        strategies/             # Question generation strategies
          simple/               # SimpleStrategy — prompt-based, N questions per doc
          dimension-driven/     # DimensionDrivenStrategy — dimension discovery, filtering, relevance, sampling
          real-world-grounded/  # RealWorldGroundedStrategy — question matching with embedding similarity
        ground-truth/           # Ground truth assigner (span-based)
      experiments/              # Experiment runner, baseline retrievers, CallbackRetriever
      langsmith/                # LangSmith upload/load/experiment-runner utilities
      utils/                    # Hashing, span utilities
    tests/                      # Vitest test suites

  backend/                      # Convex backend
    convex/
      schema.ts                 # Full schema: users, knowledgeBases, documents, datasets, questions, experiments, experimentResults, jobs, jobItems, documentChunks
      lib/auth.ts               # Clerk JWT auth context extraction
      lib/llm.ts                # OpenAI client adapter for eval-lib
      lib/batchProcessor.ts     # Shared batch processing with time budget, checkpointing, continuation
      knowledgeBases.ts         # KB CRUD (org-scoped)
      documents.ts              # Document upload via Convex storage
      generation.ts             # Question generation job orchestration
      generationActions.ts      # "use node" — strategy execution actions
      questions.ts              # Question CRUD
      datasets.ts               # Dataset CRUD
      experiments.ts            # Experiment mutations/queries (start, status, list)
      experimentActions.ts      # "use node" — single-action experiment runner via LangSmith evaluate()
      experimentResults.ts      # Per-question result mutations/queries
      rag.ts                    # Chunk mutations/queries
      ragActions.ts             # "use node" — document indexing with chunking + embedding
      langsmithSync.ts          # "use node" — LangSmith dataset sync
      langsmithRetry.ts         # Manual dataset sync retry mutation
      langsmithSyncRetry.ts     # "use node" — cron-driven failed sync retry
      users.ts                  # User record sync (getOrCreate from Clerk)
      jobs.ts                   # Job tracking with watchdog
      jobItems.ts               # Per-item tracking within job phases
      crons.ts                  # Hourly LangSmith retry cron
      auth.config.ts            # Clerk auth provider config
      testing.ts                # Test-only helper functions
      convex.json               # Bundler config (externalPackages: langsmith, @langchain/core, openai)
    tests/                      # convex-test integration tests

  frontend/                     # Next.js 16 app (Tailwind CSS v4, dark theme)
    src/app/                    # App router pages
      generate/                 # Question generation page (Convex hooks)
      experiments/              # Experiment runner page (Convex hooks)
      sign-in/                  # Clerk sign-in
      sign-up/                  # Clerk sign-up
    src/components/             # UI components
      AuthGate.tsx              # Centralized Clerk auth + org gate
      ConvexClientProvider.tsx  # Convex + Clerk provider with graceful fallback
      KBSelector.tsx            # Knowledge base selection/creation
      FileUploader.tsx          # Document upload to Convex storage
      Header.tsx                # App header with org switcher
      ModeSelector.tsx          # Generate/Experiments mode tabs
      StrategySelector.tsx      # Question generation strategy picker
      DimensionWizard.tsx       # Dimension-driven strategy config UI
      GenerateConfig.tsx        # Generation configuration panel
      QuestionList.tsx          # Generated questions display
      DocumentViewer.tsx        # Document content viewer
    src/lib/convex.ts           # Convex API re-exports
    src/middleware.ts            # Clerk auth middleware

data/                           # Sample data files (shared, at repo root)
openspec/                       # OpenSpec change management artifacts
pnpm-workspace.yaml             # Workspace config
```

## Key commands

```bash
# From repo root (convenience scripts delegate to packages)
pnpm build              # Build eval-lib with tsup (outputs to packages/eval-lib/dist/)
pnpm test               # Run vitest tests in eval-lib
pnpm typecheck          # TypeScript check eval-lib
pnpm dev                # Start frontend Next.js dev server
pnpm dev:backend        # Start Convex dev server (watches + hot-deploys)
pnpm deploy:backend     # Deploy Convex to production
pnpm typecheck:backend  # TypeScript check backend

# Or run directly in packages
pnpm -C packages/eval-lib build
pnpm -C packages/eval-lib test
pnpm -C packages/backend test      # Run convex-test integration tests
pnpm -C packages/frontend dev
pnpm -C packages/frontend build    # Production build (good for verifying TypeScript)

# One-shot Convex deploy (useful for CI or quick verification)
cd packages/backend && npx convex dev --once
```

## Development workflow

After changing library code in `packages/eval-lib/src/`:
1. `pnpm build` at project root (rebuilds eval-lib dist/)
2. Restart the Next.js dev server (Turbopack caches resolved modules)

Backend changes in `packages/backend/convex/` are automatically picked up by `pnpm dev:backend`.

First-time setup:
```bash
pnpm install          # Run at repo root — links all workspace packages
pnpm build            # Build the eval-lib so frontend and backend can resolve imports
cp packages/frontend/.env.example packages/frontend/.env  # Then fill in values
pnpm dev:backend      # First run: creates Convex project, deploys schema
pnpm dev              # Start frontend
```

## Environment

See `packages/frontend/.env.example` for all frontend env vars and `packages/backend/.env.example` for backend.

Key variables:
- `NEXT_PUBLIC_CONVEX_URL` — Convex deployment URL (from `npx convex dev`)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk auth keys
- `OPENAI_API_KEY` — Required in both frontend `.env` and Convex dashboard env vars
- `LANGSMITH_API_KEY` — Required for experiment execution (set in Convex dashboard env vars)

Node >= 18, pnpm for package management, TypeScript strict mode, ESM (`"type": "module"`).

## Architecture notes

### Evaluation approach

The system uses span-based (character-level) evaluation exclusively:
- Ground truth is specified as `CharacterSpan[]` with exact text positions in source documents
- Metrics (`recall`, `precision`, `iou`, `f1`) measure character-level overlap
- `PositionAwareChunker` interface required for chunkers that participate in evaluation

### Synthetic data generation

Three strategies, selectable from the frontend:

- **SimpleStrategy**: Prompt-based. Generates N questions per document.
- **DimensionDrivenStrategy**: Structured diversity. Pipeline: load dimensions → pairwise filter combinations → summarize docs → build relevance matrix → stratified sample → batch generate per document.
- **RealWorldGroundedStrategy**: Matches real-world questions to documents using embedding similarity.

All strategies produce `GeneratedQuery[]`, which are then passed to the `GroundTruthAssigner` to create labeled evaluation data with character spans.

### Experiment execution

Experiments run via LangSmith's native `evaluate()` API:
1. `experiments.start` mutation creates experiment + job records, schedules `runExperiment` action
2. `runExperiment` (single Convex action) handles the full pipeline:
   - Ensures KB is indexed (skips if chunks already exist)
   - Ensures dataset is synced to LangSmith (delegates to `syncDataset` action)
   - Creates a `CallbackRetriever` (eval-lib) backed by Convex vector search
   - Calls `runLangSmithExperiment()` with `onResult` callback that writes per-question results to Convex
   - Aggregates scores and marks experiment complete
3. Results appear in both Convex (real-time UI) and LangSmith (comparison/analytics)

Key eval-lib types for experiment integration:
- `CallbackRetriever` — implements `Retriever` interface via user-provided callbacks (allows Convex to plug in its vector search without eval-lib knowing Convex details)
- `ExperimentResult` — `{ query, retrievedSpans, scores }` emitted per question via `onResult`

### Backend (Convex)

- **Auth**: Clerk JWT with org-scoped access. Every public function calls `getAuthContext(ctx)` to extract userId/orgId. User records synced via `users.getOrCreate`.
- **Job pipeline**: Long-running operations (question generation) use a batch processor with 8-minute time budget, per-item checkpointing, continuation scheduling, and watchdog recovery. Experiment execution uses a single action (no batch processor).
- **RAG**: Position-aware chunking (RecursiveCharacterChunker) + OpenAI embeddings (text-embedding-3-small, 1536 dims) + Convex vector search. Chunks store character offsets for direct metric compatibility.
- **LangSmith sync**: Dataset sync is a separate action (`langsmithSync.syncDataset`). Experiment sync happens natively during `evaluate()` — no separate sync step.
- **`"use node"` constraint**: Files with `"use node"` can ONLY contain actions. Mutations/queries must be in separate files.
- **`vectorSearch` constraint**: `ctx.vectorSearch()` is only available in actions, not queries. Pattern: vectorSearch in action → hydrate via internalQuery.
- **External packages**: `convex.json` marks `langsmith`, `@langchain/core`, and `openai` as external packages (not bundled by esbuild, installed on Convex server). Both `langsmith` and `@langchain/core` must be in `package.json` dependencies for the Convex bundler to resolve them correctly with pnpm.

### Frontend

- Convex reactive queries (`useQuery`/`useMutation`) for real-time UI updates
- Clerk handles authentication and organization switching via `AuthGate` component
- ConvexClientProvider with graceful fallback when Clerk/Convex not configured
- Design system: dark theme, JetBrains Mono, custom color tokens (accent: `#6ee7b7`)

### Testing

- eval-lib: 133 vitest tests covering strategies, ground-truth assigners, metrics, types, and utilities (3 pre-existing dimension test failures)
- backend: 5 convex-test integration tests for batch processor
- Mock LLM clients for testing strategies (return canned JSON responses)
