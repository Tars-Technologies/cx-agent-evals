# External Integrations

**Analysis Date:** 2026-03-21

## APIs & External Services

**LLM & Embeddings:**
- **OpenAI** - Language models and text embeddings
  - SDK/Client: `openai` package
  - Auth: `OPENAI_API_KEY` environment variable
  - Used in: `packages/eval-lib/src/llm/client.ts`, `packages/eval-lib/src/embedders/openai.ts`, `packages/backend/convex/generation/actions.ts`
  - Models: `gpt-4o`, `text-embedding-3-small` (default, 1536 dims), `text-embedding-3-large` (3072 dims), `text-embedding-ada-002`

**Reranking (Optional):**
- **Cohere** - Semantic reranking for retrieval results
  - SDK/Client: `cohere-ai` package (optional dependency)
  - Auth: `COHERE_API_KEY` (implicitly from Cohere SDK, if used)
  - Used in: `packages/eval-lib/src/rerankers/cohere.ts`
  - Models: `rerank-english-v3.0` (default), `rerank-v3.5`, `rerank-english-v2.0`

**Other Embedder Integrations (Optional):**
- **Jina** - Alternative embedding provider
  - SDK/Client: Jina API via HTTP (no direct SDK in eval-lib)
  - Used in: `packages/eval-lib/src/embedders/jina.ts`

- **Voyage AI** - Alternative embedding provider
  - SDK/Client: Voyage API via HTTP
  - Used in: `packages/eval-lib/src/embedders/voyage.ts`

## Experiment Tracking & Dataset Management

**LangSmith:**
- **Service**: LangSmith (LangChain-managed experiment tracking platform)
- **SDK/Client**: `langsmith` package 0.5.0
- **Auth**: `LANGSMITH_API_KEY` environment variable (set in Convex dashboard)
- **Operations**:
  - Dataset creation and management via `packages/eval-lib/src/langsmith/upload.ts` (`uploadDataset()`)
  - Native experiment execution via `packages/eval-lib/src/langsmith/experiment.ts` (`runLangSmithExperiment()`)
  - Dataset sync from Convex to LangSmith: `packages/backend/convex/langsmith/sync.ts` (`syncDataset` action)
  - Manual retry mutations: `packages/backend/convex/langsmith/retry.ts`
  - Hourly cron-driven retry: `packages/backend/convex/crons.ts`
- **Data Flow**: Generated questions (ground truth with character spans) → LangSmith dataset → experiment evaluation → results returned to Convex

## Data Storage

**Databases:**
- **Convex Database** - Primary transactional database
  - Connection: `NEXT_PUBLIC_CONVEX_URL` (frontend), Convex project (backend)
  - Client: Convex SDK (`convex` package)
  - Schema: `packages/backend/convex/schema.ts`
  - Tables: users, knowledgeBases, documents, datasets, questions, retrievers, experiments, experimentResults, documentChunks, indexingJobs, generationJobs
  - Vector search: Native vector index on `documentChunks` table (1536-dim embeddings for text-embedding-3-small)

**File Storage:**
- **Convex Storage** - Document file uploads
  - Used for: PDF/markdown files uploaded via frontend
  - Reference: `fileId` field in documents table points to `_storage` reference
  - Accessed via: `packages/frontend/src/components/FileUploader.tsx`

**Caching:**
- None explicitly configured - LangSmith caches experiment results and datasets

## Authentication & Identity

**Auth Provider:**
- **Clerk** - User authentication and organization management
  - SDK/Client: `@clerk/nextjs` for frontend, `@clerk/themes` for UI
  - Auth:
    - Frontend: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (public)
    - Backend: `CLERK_SECRET_KEY` (server-side)
    - JWT validation: `CLERK_JWT_ISSUER_DOMAIN` in Convex auth config
  - Implementation:
    - Frontend auth gate: `packages/frontend/src/components/AuthGate.tsx` (Clerk auth + org verification)
    - Middleware: `packages/frontend/src/middleware.ts` (Clerk request auth)
    - Backend auth context: `packages/backend/convex/lib/auth.ts` (`getAuthContext()` extracts userId/orgId from Clerk JWT)
    - Auth config: `packages/backend/convex/auth.config.ts`
  - Features: Organization switching, user record sync via `packages/backend/convex/crud/users.ts` (`getOrCreate`)

## Document Processing & Parsing

**Text Extraction & Conversion:**
- **@mozilla/readability** - Article/document readability extraction
  - Used in: `packages/eval-lib/src/file-processing/` for processing web content
  - Purpose: Clean text extraction from HTML/web documents

- **linkedom** - DOM implementation for server-side parsing
  - Used in: Document scraping and HTML processing in eval-lib
  - Purpose: Parse HTML in Node.js environment (server-side equivalent of browser DOM)

- **turndown** - HTML to Markdown converter
  - Used in: Converting extracted HTML to clean Markdown for chunking
  - Purpose: Normalize document formats for consistent processing

- **unpdf** - PDF text and structured data extraction
  - Used in: Document upload pipeline (`packages/backend/convex/retrieval/indexingActions.ts`)
  - Purpose: Extract text from PDF files with position awareness

## Monitoring & Observability

**Error Tracking:**
- None explicitly configured (no Sentry, DataDog, etc.)

**Logs:**
- Standard console logging across eval-lib, backend, and frontend
- Backend Convex logs visible via `npx convex dev` and Convex dashboard

**Experiments & Analytics:**
- **LangSmith** - Serves as experiment tracking and comparison platform
  - Tracks question generation jobs, retrieval experiments, metric scores
  - Accessible at: `dataset.langsmithUrl` (stored in datasets table)

## CI/CD & Deployment

**Hosting:**
- **Convex** - Backend hosting platform
  - Deployment: `npx convex deploy` from `packages/backend/`
  - Hot reload dev: `npx convex dev`
  - Environment variables managed in Convex dashboard

- **Vercel** - Frontend hosting (Next.js optimized)
  - Deployment: Git-based (push to trigger builds)
  - Monorepo detection: `next` in root `package.json` for pnpm workspace support

**CI Pipeline:**
- None explicitly configured in codebase (would be configured in GitHub Actions, etc.)

## Webhooks & Callbacks

**Incoming:**
- Convex storage webhooks (implicit) - document uploads trigger indexing via WorkPool
- Clerk webhooks (implicit) - user/org changes sync to Convex users table

**Outgoing:**
- LangSmith dataset creation - Convex action `syncDataset` calls `uploadDataset()` to push question datasets
- LangSmith experiment execution - `runLangSmithExperiment()` receives `onResult` callback to write per-question results back to Convex (`packages/backend/convex/experiments/results.ts`)

## Job Queue & Background Processing

**WorkPool (Convex Distributed Job Queue):**
- **Service**: @convex-dev/workpool
- **Used for**:
  1. **Question Generation** - `packages/backend/convex/generation/orchestration.ts` queues generation jobs per document or for full corpus
  2. **Document Indexing** - `packages/backend/convex/retrieval/indexing.ts` queues chunking and embedding jobs
  3. **Experiment Evaluation** - `packages/backend/convex/experiments/orchestration.ts` queues single experiment runner action
  4. **LangSmith Retry** - `packages/backend/convex/langsmith/syncRetry.ts` (cron-driven hourly retry)
- **Callback Pattern**: Each job enqueues an action (`generateForDocument`, `indexDocument`, `runExperiment`, etc.) that processes and calls `applyResult()` to update job status
- **Cancellation**: Jobs stored with `workIds` for selective cancellation via `ctx.storage.cancel(workId)`

## Vector Search & Retrieval

**In-Memory Vector Store (Optional):**
- InMemory vector store in eval-lib for testing
- Used in: Standalone retrieval testing without backend

**Convex Vector Search:**
- Native vector search in Convex database
- Index: `documentChunks` table with `by_embedding` vector index (1536 dims)
- Used in:
  - `packages/backend/convex/lib/vectorSearch.ts` - Shared helper for embed → search → post-filter → topK pattern
  - `packages/backend/convex/retrieval/retrieverActions.ts` - Standalone retrieval testing
  - `packages/backend/convex/experiments/actions.ts` - Experiment evaluation (CallbackRetriever backed by Convex vector search)
- Post-filtering: Over-fetches by 4x to compensate for `indexConfigHash` filtering (Convex vector search only supports direct field filtering by `kbId`)

## Registry & Plugin System

**Embedder Registry:**
- `packages/eval-lib/src/registry/embedders.js` - Central registry of available embedders (OpenAI, Cohere, Voyage, Jina)
- Used in: `packages/eval-lib/src/llm/embedder-factory.ts` for dynamic embedder creation via `createEmbedder(name, config)`

**Reranker Registry:**
- `packages/eval-lib/src/registry/rerankers.js` - Central registry of available rerankers (Cohere, Voyage, Jina)
- Pattern: Optional dependencies loaded on-demand via dynamic imports

## Environment Configuration

**Required env vars (all packages):**
- `OPENAI_API_KEY` - OpenAI API key (required in frontend .env and Convex dashboard env vars)
- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL (frontend .env)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk public key (frontend .env)
- `CLERK_SECRET_KEY` - Clerk secret (frontend .env, used by server middleware)

**Required env vars (backend only):**
- `LANGSMITH_API_KEY` - LangSmith API key (Convex dashboard env vars)
- `CLERK_JWT_ISSUER_DOMAIN` - Clerk JWT issuer (backend .env or Convex dashboard)

**Optional env vars:**
- `LANGSMITH_TRACING_V2` - Enable LangSmith tracing (LangSmith SDK standard)
- `LANGSMITH_PROJECT` - LangSmith project name (LangSmith SDK standard)

**Secrets location:**
- Frontend: `.env` (loaded by Next.js, public keys prefixed with `NEXT_PUBLIC_`)
- Backend: Convex dashboard "Settings → Environment Variables"
- Never commit `.env` files with real keys (use `.env.example` for documentation)

---

*Integration audit: 2026-03-21*
