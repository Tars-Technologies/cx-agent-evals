# Technology Stack

**Analysis Date:** 2026-03-21

## Languages

**Primary:**
- TypeScript 5.4+ - All source code across eval-lib, backend, and frontend
- JavaScript/JSX - React components in frontend with TypeScript strict mode
- Node.js - Backend runtime for Convex actions and utilities

**Secondary:**
- Markdown - Documentation and content processing in eval-lib (via `@mozilla/readability`, `linkedom`, `turndown`)

## Runtime

**Environment:**
- Node.js >= 18 (specified in `packages/eval-lib/package.json`, `packages/backend/package.json`)
- Browser (React 19.2.3 in Next.js frontend)

**Package Manager:**
- pnpm (workspace monorepo at `pnpm-workspace.yaml`)
- Lockfile: pnpm-lock.yaml (present)

## Frameworks

**Core:**
- **Convex 1.32.0** - Backend server framework (`packages/backend/convex/`)
- **Next.js 16.1.6** - Frontend app framework with App Router (`packages/frontend/`)
- **React 19.2.3** - UI library in frontend
- **React DOM 19.2.3** - DOM rendering

**Testing:**
- Vitest 1.6+ - Unit and integration test runner
- convex-test 0.0.41 - Convex integration test framework (`packages/backend/tests/`)

**Build/Dev:**
- tsup 8.0 - TypeScript bundler for eval-lib (`packages/eval-lib/tsup.config.ts`)
- tsc - TypeScript compiler for type checking
- Tailwind CSS 4.0 - Utility CSS framework (frontend dark theme)
- Next.js build system - Frontend production builds
- Convex CLI - Backend deployment and dev server

## Key Dependencies

**AI/ML & LLM:**
- **openai 4.70.0** (backend), >=4.0 (frontend) - OpenAI API client for LLM and embedding models
- **langsmith 0.5.0** - LangSmith experiment tracking and dataset management
- **@langchain/core 1.1.0** - LangChain base types and utilities
- **cohere-ai >=7.0** (optional) - Cohere reranker integration (`packages/eval-lib/src/rerankers/cohere.ts`)

**Core Library (eval-lib):**
- **minisearch 7.2.0** - Keyword-based search for chunking and retrieval fallbacks
- **js-tiktoken 1.0.21** - Token counting for LLM context management
- **@mozilla/readability 0.6.0** - Article/document readability extraction
- **linkedom 0.18.12** - DOM implementation for server-side HTML parsing
- **turndown 7.2.2** - HTML to Markdown conversion
- **unpdf 1.4.0** - PDF text extraction
- **zod 3.23** - Runtime schema validation and type inference

**Backend (Convex):**
- **@convex-dev/workpool 0.4.0** - Distributed job queue for long-running operations (question generation, indexing, experiments)
- **convex 1.32.0** - Convex SDK with server, database, storage, auth
- All core dependencies above (shared via workspace dependency)

**Frontend:**
- **@clerk/nextjs 6.x** - Clerk authentication for Next.js
- **@clerk/themes 2.4.52** - Clerk UI theme components
- **convex 1.21.0** - Convex React client (`packages/frontend/src/components/ConvexClientProvider.tsx`)
- **react-markdown 10.1.0** - Markdown rendering in UI
- **rehype-raw 7.0.0** - Raw HTML in Markdown
- **rehype-sanitize 6.0.0** - HTML sanitization
- **remark-gfm 4.0.1** - GitHub-flavored Markdown support

## Configuration

**Environment:**
- TypeScript strict mode enabled across all packages
- ESM (`"type": "module"`) for all packages
- Frontend environment variables:
  - `NEXT_PUBLIC_CONVEX_URL` - Convex deployment endpoint (public)
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk public key (public)
  - `CLERK_SECRET_KEY` - Clerk secret key (server-side)
  - `OPENAI_API_KEY` - Required for embedding/generation

- Backend environment variables (Convex dashboard):
  - `OPENAI_API_KEY` - Required for LLM calls in generation actions
  - `LANGSMITH_API_KEY` - Required for LangSmith experiment execution
  - `CLERK_JWT_ISSUER_DOMAIN` - Clerk JWT issuer for auth validation

**Build:**
- `tsup.config.ts` - eval-lib bundler config (ESM + CJS, dts generation, treeshaking, external packages)
- `next.config.ts` - Next.js config with serverExternalPackages for eval-lib and Node.js deps
- `convex.json` - Convex bundler config with externalPackages: `langsmith`, `@langchain/core`, `openai`, `minisearch`, `@mozilla/readability`, `linkedom`, `turndown`, `unpdf`
- `tsconfig.json` in each package with path aliases (`@/*` for frontend, `@convex/*` for backend access)
- Convex auth config via `packages/backend/convex/auth.config.ts` (Clerk JWT validation)

## Platform Requirements

**Development:**
- Node >= 18
- pnpm for monorepo management
- Convex CLI for backend development (`npx convex dev`)
- Clerk account (free tier available) for authentication
- OpenAI API key for LLM capabilities
- LangSmith account/API key for experiment tracking (optional but recommended)

**Production:**
- Convex Hosting (backend deployment)
- Vercel (Next.js frontend) - optimized for monorepo via `pnpm-workspace.yaml` and shared config
- Clerk (authentication as a service)
- OpenAI API (LLM/embedding service)
- LangSmith (experiment tracking as a service)

---

*Stack analysis: 2026-03-21*
