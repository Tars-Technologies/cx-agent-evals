# RAG & Agent Evals

[![npm version](https://img.shields.io/npm/v/@tars-inc/eval-lib.svg)](https://www.npmjs.com/package/@tars-inc/eval-lib)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A TypeScript framework for evaluating RAG retrieval pipelines, with a Convex
backend and Next.js frontend. It does span-based (character-level) retrieval
evaluation, synthetic question generation, and experiment tracking via LangSmith.

## Repository structure

This is a pnpm workspace monorepo:

```
packages/
  eval-lib/     # Core evaluation library (@tars-inc/eval-lib)
  backend/      # Convex backend (schema, actions, jobs pipeline)
  frontend/     # Next.js frontend (Clerk auth, Convex reactive UI)
```

## Quick start

```bash
sfw pnpm install   # Socket Firewall (recommended); plain `pnpm install` works too
pnpm build         # build eval-lib, which backend and frontend depend on
```

Running the full app needs Convex, Clerk, and a few API keys. See
**[SETUP.md](./SETUP.md)** for the complete step-by-step guide (Convex + Clerk
setup, environment variables, dev servers, troubleshooting).

Just want the library? Install `@tars-inc/eval-lib` and see its
[package README](./packages/eval-lib/README.md) for install + quick start.

## Monorepo notes (pnpm)

- One `pnpm install` at the repo root installs every package; there's a single
  root lockfile. You don't install per package.
- Internal packages link locally via the `workspace:*` protocol, so backend and
  frontend use the local `eval-lib` source. After editing `eval-lib`, run
  `pnpm build` and restart the Next.js dev server (Turbopack caches modules).
- Each package has its own `node_modules`, but the entries are symlinks into a
  single shared store, so there's no real duplication. This is pnpm's strict
  layout: a package only sees the dependencies it declares.

## Architecture

- **eval-lib**: Pure TypeScript library. Chunkers, embedders, metrics (recall,
  precision, IoU, F1), synthetic question generation, and LangSmith integration.
- **backend**: Convex functions. Schema, Clerk JWT auth, file upload, org-scoped
  data, a job pipeline, RAG with vector search, and LangSmith sync.
- **frontend**: Next.js app using Convex reactive queries (`useQuery`/
  `useMutation`) for real-time UI. Clerk handles auth and organization switching.

## Deployment

For how the frontend (Vercel), backend (Convex), and `@tars-inc/eval-lib` (npm)
are deployed, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup,
tests, and PR conventions.

## License

MIT
