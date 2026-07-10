# RAG & Agent Evals

A TypeScript framework for evaluating RAG retrieval pipelines, with a Convex backend and Next.js frontend.

## Repository structure

```
packages/
  eval-lib/     # Core evaluation library (@tars-inc/eval-lib)
  backend/      # Convex backend (schema, actions, jobs pipeline)
  frontend/     # Next.js frontend (Clerk auth, Convex reactive UI)
```

## Prerequisites

- Node.js >= 18
- pnpm (`npm install -g pnpm`)
- [Socket Firewall](https://docs.socket.dev/docs/socket-firewall-free) (`npm install -g sfw`)
- A [Convex](https://convex.dev) account (free tier works)
- A [Clerk](https://clerk.com) account (free tier works)
- An [OpenAI](https://platform.openai.com) API key

Optional:
- A [LangSmith](https://smith.langchain.com) API key (for dataset/experiment sync)

## First-time setup

### 1. Install dependencies

```bash
sfw pnpm install
```

### 2. Build the eval library

The frontend and backend both depend on `eval-lib`. Build it first:

```bash
pnpm build
```

### 3. Set up Convex (backend)

Create a Convex project and deploy the schema:

```bash
cd packages/backend
npx convex dev
```

On first run, this will:
- Prompt you to log in to Convex (or create an account)
- Create a new project
- Generate a `.env.local` file with your `CONVEX_DEPLOYMENT` and `CONVEX_URL`
- Deploy the schema and functions

Copy the `CONVEX_URL` value (e.g. `https://your-deployment.convex.cloud`) — you'll need it for the frontend.

Press `Ctrl+C` to stop the dev watcher once the initial deploy succeeds.

### 4. Set up Clerk (authentication)

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) and create an application
2. Enable **Organizations** in Clerk settings (the app requires org-scoped access)
3. Copy your **Publishable Key** and **Secret Key** from the Clerk dashboard
4. Set up the Convex JWT integration:
   - In the Clerk dashboard, go to **JWT Templates** and create a new Convex template
   - In the Convex dashboard, go to **Settings > Authentication** and add Clerk as a provider using your Clerk Issuer URL (found in Clerk dashboard under **API Keys**)

### 5. Set Convex environment variables

In the [Convex dashboard](https://dashboard.convex.dev), go to your project's **Settings > Environment Variables** and add:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Used by Convex actions for embeddings and LLM calls |
| `ANTHROPIC_API_KEY` | Yes | Used by Convex actions that call Claude via `@ai-sdk/anthropic` (evaluator, agent, livechat) |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Clerk issuer domain — read by `convex/auth.config.ts` to validate JWTs |
| `COHERE_API_KEY` | No | Required only if you use the Cohere rerank refinement step in retrieval pipelines |
| `LANGSMITH_API_KEY` | No | For automatic LangSmith dataset/experiment sync |

These are server-side variables that run inside Convex actions (Node.js runtime).

### 6. Configure the frontend

Copy the example env file and fill in your values:

```bash
cp packages/frontend/.env.example packages/frontend/.env
```

Edit `packages/frontend/.env`:

```bash
# Convex — paste the URL from step 3
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# Clerk — paste keys from step 4
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# LLM provider keys (OPENAI_API_KEY, LANGSMITH_API_KEY) belong in the
# Convex dashboard environment variables — not here.
```

### 7. Start developing

Run the backend and frontend in separate terminals:

```bash
# Terminal 1: Convex dev server (watches for changes, hot-deploys)
pnpm dev:backend

# Terminal 2: Next.js dev server (http://localhost:3000)
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000). You should see the Clerk sign-in flow. After signing in and selecting an organization, you can:

1. Create a knowledge base
2. Upload markdown documents
3. Generate synthetic evaluation questions
4. Run retrieval experiments
5. View results with per-question metrics

## Environment variables reference

### Frontend (`packages/frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Convex deployment URL |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (starts with `pk_`) |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key (starts with `sk_`) |

### Backend (Convex dashboard environment variables)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Used by Convex actions for embeddings and LLM calls |
| `ANTHROPIC_API_KEY` | Yes | Used by Convex actions that call Claude via `@ai-sdk/anthropic` (evaluator, agent, livechat) |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Clerk issuer domain — read by `convex/auth.config.ts` to validate JWTs |
| `COHERE_API_KEY` | No | Required only if you use the Cohere rerank refinement step in retrieval pipelines |
| `LANGSMITH_API_KEY` | No | Used by LangSmith sync actions |

### Backend local (`packages/backend/.env.local`)

Auto-generated by `npx convex dev`. Do not edit manually.

## Common commands

| Command | Description |
|---------|-------------|
| `sfw pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build eval-lib |
| `pnpm dev` | Start Next.js frontend dev server |
| `pnpm dev:backend` | Start Convex backend dev server |
| `pnpm test` | Run eval-lib tests |
| `pnpm -C packages/backend test` | Run backend (Convex) tests |
| `pnpm typecheck` | TypeScript check eval-lib |
| `pnpm typecheck:backend` | TypeScript check backend |
| `pnpm -C packages/frontend build` | Production build of frontend |
| `pnpm deploy:backend` | Deploy Convex to production |

## Development workflow

After changing code in `packages/eval-lib/src/`:

1. Run `pnpm build` (rebuilds eval-lib dist/)
2. Restart the Next.js dev server (Turbopack caches resolved modules)

Backend changes in `packages/backend/convex/` are automatically picked up by `pnpm dev:backend`.

## Architecture

- **eval-lib** — Pure TypeScript library with no Node.js-specific APIs in its core. Provides chunkers, embedders, metrics (recall, precision, IoU, F1), synthetic question generation, and LangSmith integration.
- **backend** — Convex functions: schema, auth (Clerk JWT), file upload, org-scoped data, job pipeline with batch processing, RAG with vector search, and LangSmith sync.
- **frontend** — Next.js app using Convex reactive queries (`useQuery`/`useMutation`) for real-time UI updates. Clerk handles authentication and organization switching.

## Deployment

For how the frontend (Vercel), backend (Convex), and `@tars-inc/eval-lib` (npm) are deployed — including what every push to GitHub does, what Convex deployment a Vercel preview talks to, and the manual `npx convex deploy` flow for production — see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Releasing `@tars-inc/eval-lib`

`@tars-inc/eval-lib` is published to npm via Changesets. For the versioning policy (patch vs. minor, why major isn't used yet) and the step-by-step release flow, see [packages/eval-lib/releasing-eval-lib.md](./packages/eval-lib/releasing-eval-lib.md).

## License

MIT
