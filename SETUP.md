# Setup

Step-by-step guide to running the project locally. For a high-level overview see
[README.md](./README.md); for how the project is deployed see
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Prerequisites

- **Node.js** >= 18
- **pnpm** (`npm install -g pnpm`)
- A [Convex](https://convex.dev) account (free tier works)
- A [Clerk](https://clerk.com) account (free tier works)
- An [OpenAI](https://platform.openai.com) API key
- An [Anthropic](https://console.anthropic.com) API key

Optional:
- A [Cohere](https://cohere.com) API key, only for the Cohere rerank step
- A [LangSmith](https://smith.langchain.com) API key, only for dataset/experiment sync

## 1. Install dependencies

We recommend running the install through [Socket Firewall](https://socket.dev/),
which proxies the install and blocks known-malicious packages. Install it once with
`npm install -g sfw`, then:

```bash
sfw pnpm install
```

Plain `pnpm install` also works if you don't have `sfw`:

```bash
pnpm install
```

## 2. Build the eval library

The frontend and backend both depend on `eval-lib`. Build it first:

```bash
pnpm build
```

## 3. Set up Convex (backend)

Create a Convex project and deploy the schema:

```bash
cd packages/backend
npx convex dev
```

On first run this will:
- Prompt you to log in to Convex (or create an account)
- Create a new project
- Auto-generate `packages/backend/.env.local` with your `CONVEX_DEPLOYMENT` and
  `CONVEX_URL` (don't edit this file by hand, the CLI owns it)
- Deploy the schema and functions

Copy the `CONVEX_URL` value (e.g. `https://your-deployment.convex.cloud`); you'll
need it for the frontend in step 6.

Leave this running, or press `Ctrl+C` once the initial deploy succeeds.

## 4. Set up Clerk (authentication)

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) and create an application. 
2. Enable **Organizations** in Clerk settings; the app requires org-scoped access.
3. Copy your **Publishable Key** and **Secret Key** from the Clerk dashboard.
4. Wire up the Convex JWT integration:
   - In Clerk, go to **JWT Templates** and create a new **Convex** template.
   - Note your Clerk **Issuer URL** (Clerk dashboard, **API Keys**). You'll set it as
     `CLERK_JWT_ISSUER_DOMAIN` on the Convex deployment in the next step.

## 5. Set Convex server-side secrets

Server-side keys are **not** stored in a file; they live on the Convex deployment.
Set each one with the CLI (from `packages/backend`):

```bash
npx convex env set OPENAI_API_KEY <your-key>
npx convex env set ANTHROPIC_API_KEY <your-key>
npx convex env set CLERK_JWT_ISSUER_DOMAIN <your-clerk-issuer-url>
```

Or set them in the [Convex dashboard](https://dashboard.convex.dev) under **Settings >
Environment Variables**. List what's currently set with `npx convex env list`.

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Embeddings + LLM calls |
| `ANTHROPIC_API_KEY` | Yes | Claude calls (evaluator, agent, livechat) |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Validates Clerk JWTs (`convex/auth.config.ts`) |
| `COHERE_API_KEY` | No | Only for the Cohere rerank step |
| `LANGSMITH_API_KEY` | No | Only for LangSmith dataset/experiment sync |

## 6. Configure the frontend

Copy the example env file and fill in your values:

```bash
cp packages/frontend/.env.example packages/frontend/.env
```

Edit `packages/frontend/.env`:

```bash
# Convex: paste the URL from step 3
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# Clerk: paste keys from step 4
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

> LLM provider keys (OpenAI, Anthropic, etc.) belong on the Convex deployment
> (step 5), **not** in the frontend `.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Convex deployment URL from step 3 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key (starts with `pk_`) |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key (starts with `sk_`) |

## 7. Start developing

Run the backend and frontend in separate terminals:

```bash
# Terminal 1: Convex dev server (watches for changes, hot-deploys)
pnpm dev:backend

# Terminal 2: Next.js dev server (http://localhost:3000)
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000). You should see the Clerk
sign-in flow. After signing in and selecting an organization, you can:

1. Create a knowledge base
2. Upload Markdown documents
3. Generate synthetic evaluation questions
4. Run retrieval experiments
5. View results with per-question metrics

## Common commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build eval-lib |
| `pnpm dev` | Start Next.js frontend dev server |
| `pnpm dev:backend` | Start Convex backend dev server |
| `pnpm test` | Run eval-lib tests |
| `pnpm -C packages/backend test` | Run backend (Convex) tests |
| `pnpm typecheck` | TypeScript check eval-lib |
| `pnpm typecheck:backend` | TypeScript check backend |
| `pnpm -C packages/frontend build` | Production build of frontend |
| `pnpm deploy:backend` | Deploy Convex to production (maintainers, see [DEPLOYMENT.md](./DEPLOYMENT.md)) |

## Development workflow

After changing code in `packages/eval-lib/src/`:

1. Run `pnpm build` (rebuilds eval-lib `dist/`)
2. Restart the Next.js dev server (Turbopack caches resolved modules)

Backend changes in `packages/backend/convex/` are picked up automatically by
`pnpm dev:backend`.

## Troubleshooting

- **Frontend can't reach the backend**: confirm `NEXT_PUBLIC_CONVEX_URL` in
  `packages/frontend/.env` matches the `CONVEX_URL` from `npx convex dev`.
- **Auth errors / JWT rejected**: confirm `CLERK_JWT_ISSUER_DOMAIN` is set on the
  Convex deployment (`npx convex env list`) and matches your Clerk Issuer URL.
- **Changes to eval-lib not picked up**: rebuild with `pnpm build` and restart the
  Next.js dev server (Turbopack caches resolved modules).
