# Architecture

**Analysis Date:** 2026-03-21

## Pattern Overview

**Overall:** Layered three-tier monorepo architecture with clear separation between:
- **eval-lib**: Framework layer (TypeScript, browser-safe core + Node.js sub-paths)
- **backend**: Convex serverless API layer with domain-driven organization
- **frontend**: Next.js 16 React client with real-time Convex reactivity

**Key Characteristics:**
- pnpm workspace with local package dependencies (workspace:*)
- Domain-driven backend structure (generation, retrieval, experiments, langsmith)
- Span-based (character-level) evaluation exclusively
- Event-driven job orchestration via WorkPool
- Org-scoped access control via Clerk JWT
- Real-time UI reactivity via Convex `useQuery` and `useMutation` hooks

## Layers

**Presentation (Frontend):**
- Purpose: Real-time UI for knowledge base management, question generation, and experiment execution
- Location: `packages/frontend/src/`
- Contains: Next.js App Router pages, React components, Tailwind CSS
- Depends on: eval-lib (workspace), Convex client, Clerk auth
- Used by: Users in browsers

**API (Backend):**
- Purpose: Convex serverless functions organizing domain logic, auth, data persistence, and long-running job orchestration
- Location: `packages/backend/convex/`
- Contains: Queries, mutations, actions, crons, schema
- Depends on: eval-lib (workspace), Convex runtime, LangSmith, OpenAI
- Used by: Frontend via Convex client, internal WorkPool callbacks

**Core Framework (eval-lib):**
- Purpose: Reusable TypeScript library for RAG evaluation, chunking, embeddings, question generation, retrieval
- Location: `packages/eval-lib/src/`
- Contains: Type system, chunkers, embedders, retrievers, synthetic data generation, metrics
- Depends on: LangChain, zod, external LLM/embedder APIs
- Used by: Backend (via Convex), frontend (re-exports), published as npm package

## Data Flow

**Knowledge Base Ingestion:**

1. User uploads document via `FileUploader` → `documents.upload` mutation
2. Document stored in Convex storage, metadata persisted to `documents` table
3. Chunks created on-demand during indexing (lazy evaluation)

**Question Generation Pipeline:**

1. User configures generation (strategy, settings) → `generation.orchestration.startGeneration` mutation
2. Creates `datasets` record + `generationJobs` record
3. Enqueues per-document or single WorkPool action via `generationPool`
4. Action (`generation/actions.ts`) instantiates strategy (SimpleStrategy, DimensionDrivenStrategy, RealWorldGroundedStrategy)
5. Strategy generates `GeneratedQuery[]` from corpus → `GroundTruthAssigner` adds character spans
6. Per-question `questions` records inserted, `generationJobs` status updated
7. Frontend reactive `useQuery(api.generation.orchestration.getJob)` reflects progress in real-time

**Indexing Pipeline:**

1. Retriever creation or experiment start triggers indexing
2. `retrieval.indexing.startIndexing` mutation creates `indexingJobs`, fans out per-document WorkPool actions
3. `indexingActions.ts` executes two-phase indexing:
   - Phase 1: Chunk document using `PositionAwareChunker` (RecursiveCharacterChunker)
   - Phase 2: Embed chunks with OpenAI `text-embedding-3-small`, insert to Convex vector store
4. Chunks stored in `documentChunks` table with character offsets for evaluation compatibility
5. `retrieverActions.ts` updates retriever status to `ready` once chunks exist

**Experiment Execution:**

1. User creates experiment → `experiments.orchestration.start` mutation
2. Creates `experiments` record + enqueues single WorkPool action via `experimentPool`
3. `experiments/actions.ts` `runExperiment`:
   - Ensures KB is indexed (or uses pre-indexed retriever)
   - Ensures dataset is synced to LangSmith via `langsmith.sync.syncDataset`
   - Creates `CallbackRetriever` backed by Convex vector search (`vectorSearchWithFilter`)
   - Calls `runLangSmithExperiment()` which:
     - Iterates dataset questions
     - Retrieves via CallbackRetriever
     - Computes metrics (recall, precision, IoU, F1) on character spans
     - Emits `ExperimentResult` per question via `onResult` callback
   - Writes per-question results to `experimentResults` table
   - Syncs final aggregated scores back to LangSmith

**State Management:**

- **Persistent state**: Convex database (users, knowledgeBases, documents, datasets, questions, experiments, chunks, jobs)
- **Job state**: `status` field (pending → running → completed/failed) + progress counters via WorkPool
- **Frontend state**: React hooks (selectedKbId, datasetId, jobId) + Convex reactive queries
- **External state**: LangSmith dataset sync status, experiment results

## Key Abstractions

**Chunker Interface:**
- Purpose: Fragment documents into overlapping/non-overlapping units with optional position awareness
- Examples: `packages/eval-lib/src/chunkers/` (RecursiveCharacterChunker, SentenceChunker, TokenChunker, SemanticChunker)
- Pattern: Implement `Chunker` or `AsyncPositionAwareChunker` with `chunk()` method returning `PositionAwareChunk[]`

**Question Strategy:**
- Purpose: Generate diverse questions from a corpus
- Examples: `packages/eval-lib/src/synthetic-datagen/strategies/simple/`, `dimension-driven/`, `real-world-grounded/`
- Pattern: Implement `QuestionStrategy` with `generate(context)` returning `GeneratedQuery[]`

**Retriever Interface:**
- Purpose: Abstract retrieval mechanism (vector, BM25, hybrid, callback-based)
- Examples: `VectorRAGRetriever`, `CallbackRetriever`, `PipelineRetriever` in `packages/eval-lib/src/retrievers/`
- Pattern: Implement `Retriever` with `retrieve(query)` returning `PositionAwareChunk[]`

**CallbackRetriever:**
- Purpose: Allows Convex to plug in vector search without eval-lib knowing Convex details
- Pattern: Accept user-provided async `retrieve` callback, delegates to callback during evaluation

**Embedder Interface:**
- Purpose: Convert text to embeddings
- Examples: `OpenAIEmbedder` at `packages/eval-lib/src/embedders/openai.ts`
- Pattern: Implement `Embedder` with `embed(text)` and `embed(texts[])` methods

**Metric Functions:**
- Purpose: Compute evaluation scores on character span overlap
- Examples: `recall`, `precision`, `iou`, `f1` in `packages/eval-lib/src/evaluation/metrics/`
- Pattern: Pure functions `(groundTruth: CharacterSpan[], retrieved: CharacterSpan[]) => number`

**GroundTruthAssigner:**
- Purpose: Assign character-level span references from generated questions to source document positions
- Location: `packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts`
- Pattern: Uses token-level matching + embedding similarity to find relevant character spans in source text

**WorkPool:**
- Purpose: Distributed job orchestration for long-running, parallelizable tasks
- Usage: Instantiated in `generation/orchestration.ts`, `retrieval/indexing.ts`, `experiments/orchestration.ts`
- Pattern: Enqueue actions, track status, retry with exponential backoff, callbacks on completion

## Entry Points

**Frontend Entry:**
- Location: `packages/frontend/src/app/layout.tsx`
- Triggers: User navigates to domain, Clerk auth middleware validates
- Responsibilities: Wraps app with ConvexClientProvider, AuthGate, and RootLayout

**Backend Entry:**
- Location: `packages/backend/convex/schema.ts`, public mutations/queries in `crud/`, `generation/`, `retrieval/`, `experiments/`
- Triggers: Frontend calls `api.xxx.yyy.functionName()` or Convex cron
- Responsibilities: Validate auth, enforce org scoping, delegate to domain logic or enqueue WorkPool actions

**Library Entry:**
- Location: `packages/eval-lib/src/index.ts`
- Triggers: Backend imports (eval-lib types, strategies), frontend re-exports (types only)
- Responsibilities: Export canonical types (Document, Corpus, Retriever), factories (createDocument), strategies, metrics

**Cron Entry:**
- Location: `packages/backend/convex/crons.ts`
- Triggers: Hourly by Convex
- Responsibilities: Retry failed LangSmith dataset syncs via `langsmith.syncRetry`

## Error Handling

**Strategy:** Explicit error messages propagated from Convex to frontend

**Patterns:**
- Convex mutations/queries throw `new Error("message")` on validation or auth failures
- WorkPool actions catch errors, update job status to `failed` with `error` field, allow retries up to `maxAttempts`
- Frontend catches mutation errors in `useMutation` callbacks, displays toast or modal
- Indexing errors logged per-document in `indexingJobs.errors` array; job marked `completed_with_errors` if some succeed

## Cross-Cutting Concerns

**Logging:** Console.log in backend actions (visible in Convex dev server / dashboard), no structured logging framework

**Validation:**
- Zod schemas for eval-lib types (DocumentSchema, CorpusSchema, DatasetExampleSchema)
- Convex validators (v.string(), v.id(), v.any()) for argument validation
- Auth context extracted early in every public function via `getAuthContext()`

**Authentication:**
- Clerk JWT middleware (frontend) + Clerk JWT validation (backend)
- `AuthGate` component redirects unauthenticated users to `/sign-in`
- Org ID + org role extracted from JWT custom claims
- Every backend function scopes queries/mutations to `orgId` from auth context

**Authorization:**
- Org-scoped: All resources (KBs, documents, datasets, questions, experiments) filtered by `orgId`
- Retriever sharing: Protected via `isSharedIndex` flag (prevents deleting while in use)
- No fine-grained field-level access control (all org members see all org resources)

