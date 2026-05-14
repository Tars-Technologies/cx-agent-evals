# Deployment

This document describes how `cx-agent-evals` is deployed today, what each push to GitHub does, and how the different deployment surfaces relate to each other.

If you are looking for first-time local setup instead, see [README.md](./README.md).

## Deployment surfaces

The project has three independently-deployed surfaces:

| Surface | What it is | Where it lives | How it deploys |
|---|---|---|---|
| **Frontend** | The Next.js app in `packages/frontend` | Vercel | Automatic on every push (preview or production) via Vercel's GitHub integration |
| **Backend** | The Convex functions in `packages/backend/convex` | Convex (production deployment) | **Manual**, by running `npx convex deploy` from `packages/backend` |
| **`@tars-inc/eval-lib`** | The TypeScript library in `packages/eval-lib` | npm registry | Automatic on merge to `main` via [Changesets](https://github.com/changesets/changesets) and `.github/workflows/release.yml` |

These three surfaces are **decoupled**. A Vercel deploy does not deploy Convex. A Convex deploy does not republish `eval-lib`. A merge to `main` does not by itself update Convex production.

## Frontend (Vercel)

The Vercel project is connected to the GitHub repo via Vercel's built-in GitHub integration (not via GitHub Actions — there is no Vercel-related workflow file in `.github/workflows/`).

### What each push does

| Push target | Vercel build | Vercel deployment URL |
|---|---|---|
| `main` | Production build | The production domain |
| Any other branch (including PRs) | Preview build | A unique preview URL per commit (e.g. `cx-agent-evals-git-<branch>-<team>.vercel.app`) |

This means **every push to any branch triggers a Vercel build**. That is expected, and it is Vercel's default behavior — it is not something configured in this repo.

The build command Vercel runs is the standard `next build` from `packages/frontend/package.json`. There is **no `convex deploy` step in the Vercel build**, so a Vercel preview build never modifies any Convex deployment.

### What Convex deployment does a preview point to?

A preview build does not deploy Convex, but it still needs a Convex URL to connect to at runtime. That URL comes from `NEXT_PUBLIC_CONVEX_URL`, which is read from the Vercel project's Environment Variables.

Vercel scopes environment variables per environment (Production / Preview / Development). The current configuration is:

- **Production** environment in Vercel → `NEXT_PUBLIC_CONVEX_URL` points to the production Convex deployment.
- **Preview** environment in Vercel → `NEXT_PUBLIC_CONVEX_URL` is whatever is configured for the Preview scope in the Vercel dashboard.

**There is no shared "staging" Convex deployment.** The project has exactly two kinds of Convex deployments today:

1. One **production** Convex deployment (deployed manually — see below).
2. One **dev** Convex deployment **per developer**, created locally by `npx convex dev`. These are not shared and are not used by Vercel.

> **Practical implication:** because there is no staging Convex, if the Preview environment in Vercel is set to the production Convex URL, every preview deployment hits production Convex (production schema, production data, production rate limits). If you want previews to be safe to click around in, point the Preview-scoped `NEXT_PUBLIC_CONVEX_URL` at a Convex deployment you are comfortable writing to, or treat preview builds as read-only. Check the Vercel project's Environment Variables tab to confirm the current setting.

### Do we get a separate Convex deployment per preview?

No. We do not use [Convex preview deployments](https://docs.convex.dev/production/hosting/preview-deployments) today. Enabling that would require:

- Changing the Vercel build command to something like `npx convex deploy --cmd 'pnpm build' --preview-create` (with `CONVEX_DEPLOY_KEY` set in Vercel).
- Accepting the cost of an ephemeral Convex deployment per PR.

That change is out of scope for this document — it is tracked separately if/when we decide to adopt it.

## Backend (Convex)

The Convex backend has **no CI deployment pipeline**. Production Convex is deployed by hand.

### Deploying to production

From `packages/backend`:

```bash
npx convex deploy
```

Or from the repo root (equivalent):

```bash
pnpm deploy:backend
```

This pushes the current local working tree of `packages/backend/convex/` to the production Convex deployment. It does **not** read from `main` on GitHub — it deploys whatever you have checked out locally. Make sure your local checkout matches the commit you intend to ship before running it.

The deployer must:

- Have access to the production Convex deployment (via `CONVEX_DEPLOY_KEY` or an authenticated `npx convex login` session).
- Have run `pnpm install` and `pnpm build` recently enough that local types and the built `eval-lib` are current.

### Convex environment variables

Convex server-side environment variables (used inside actions) are configured in the **Convex dashboard** per deployment, not in this repo. Required variables are listed in [`packages/backend/env.example`](./packages/backend/env.example) and the README's [environment variables reference](./README.md#environment-variables-reference). Setting an env var in the Convex dashboard does not require a redeploy of the functions.

### Developer dev deployments

Each developer runs `npx convex dev` from `packages/backend` to get their own personal Convex deployment for local work. These are isolated from production and from each other. The Convex deployment name lives in `packages/backend/.env.local`, which is git-ignored.

## `@tars-inc/eval-lib` (npm)

The library is published to npm via [Changesets](https://github.com/changesets/changesets). The workflow is in [`.github/workflows/release.yml`](./.github/workflows/release.yml) and runs on every push to `main`.

### Day-to-day flow

1. While making changes to `packages/eval-lib`, run `pnpm changeset` to record a version bump (patch / minor / major) and a short summary. Commit the generated file in `.changeset/`.
2. Open a PR as normal. Vercel will still create a frontend preview for the PR (it doesn't know or care about the changeset).
3. When the PR merges to `main`, the `Release` workflow runs:
   - If there are pending changesets, it opens (or updates) a "Version Packages" PR that bumps `package.json` versions and updates `CHANGELOG.md`.
   - When that "Version Packages" PR is itself merged, the workflow publishes the new version of `@tars-inc/eval-lib` to npm.
4. Consumers (including this repo's `frontend` and `backend` packages) pick up the new version through the workspace `workspace:*` link locally; external consumers update via `pnpm up @tars-inc/eval-lib`.

The workflow only handles publishing the library. It does **not** deploy the frontend or the backend.

## End-to-end picture

```
                 git push (any branch)
                          │
            ┌─────────────┴──────────────┐
            ▼                            ▼
    Vercel GitHub integration     (no other CI triggers
            │                      for frontend/backend)
            │
   ┌────────┴────────┐
   ▼                 ▼
 main branch?     other branch?
   │                 │
   ▼                 ▼
 Production       Preview build
 build            (unique URL per commit)
   │                 │
   ▼                 ▼
 Reads NEXT_PUBLIC_CONVEX_URL from Vercel
 env vars (Production scope vs. Preview scope)
   │                 │
   └────────┬────────┘
            ▼
     Convex production deployment
     (deployed manually via
      `npx convex deploy`)
```

Separately, on merge to `main`:

```
 main ──► .github/workflows/release.yml ──► Changesets ──► npm publish @tars-inc/eval-lib
```

## Environment variable matrix

A consolidated view of where each variable lives. `Y` = required, `–` = not used in that location.

| Variable | Local `.env` (frontend) | Vercel Production | Vercel Preview | Convex dashboard | Local `.env.local` (backend) |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Y (your dev Convex) | Y (prod Convex URL) | Y (whichever Convex you want previews to hit) | – | – |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Y | Y | Y | – | – |
| `CLERK_SECRET_KEY` | Y | Y | Y | – | – |
| `OPENAI_API_KEY` | Y | Y | Y | Y (used by Convex actions) | – |
| `LANGSMITH_API_KEY` | optional | optional | optional | optional (required for experiment runs) | – |
| `CONVEX_DEPLOYMENT`, `CONVEX_URL` | – | – | – | – | Y (auto-generated by `npx convex dev`) |
| `CLERK_JWT_ISSUER_DOMAIN` | – | – | – | Y (set as Convex auth provider) | – |

## Common gotchas

- **A Vercel preview is talking to production Convex.** Check the Vercel project's Environment Variables tab and confirm what `NEXT_PUBLIC_CONVEX_URL` is set to under the **Preview** scope. There is no automated guard against this.
- **Backend code merged to `main` but production not updated.** Convex production is only updated by someone running `npx convex deploy` locally. Merging to `main` does nothing on its own.
- **Schema drift between previews and production Convex.** If a preview build relies on a new field/table that hasn't been deployed to the Convex deployment the preview connects to, the preview will fail at runtime. Either deploy Convex first, or point the preview at a Convex deployment that has the new schema.
- **`@tars-inc/eval-lib` not republished after a change.** If you change `packages/eval-lib/src` but forget to run `pnpm changeset`, the release workflow won't publish a new version. External consumers will keep getting the old version.

## Future work (not implemented today)

These are not part of the current deployment setup. They're listed here so the doc is honest about what is and isn't in place.

- Per-PR ephemeral Convex preview deployments (via `npx convex deploy --preview-create`).
- A shared staging Convex deployment for Vercel previews to point at.
- A CI step that deploys Convex automatically on merge to `main`.
- A CI step that runs `pnpm -C packages/backend test` and `pnpm -C packages/frontend build` on PRs to catch breakage before Vercel does.

Open a GitHub issue if you want to drive any of these.
