# Deployment

This document describes how `cx-agent-evals` is deployed today, what each push to GitHub does, and how the different deployment surfaces relate to each other.

If you are looking for first-time local setup instead, see [README.md](./README.md).

## Deployment surfaces

The project has three independently-deployed surfaces:

| Surface | What it is | Where it lives | How it deploys |
|---|---|---|---|
| **Frontend** | The Next.js app in `packages/frontend` | Vercel | Automatic on push to `main` via Vercel's GitHub integration |
| **Backend** | The Convex functions in `packages/backend/convex` | Convex (production deployment) | **Manual**, by running `npx convex deploy` from `packages/backend` |
| **`@tars-inc/eval-lib`** | The TypeScript library in `packages/eval-lib` | npm registry | Automatic on merge to `main` via [Changesets](https://github.com/changesets/changesets) and `.github/workflows/release.yml` |

These three surfaces are **decoupled**. A Vercel deploy does not deploy Convex. A Convex deploy does not republish `eval-lib`. A merge to `main` does not by itself update Convex production.

## Frontend (Vercel)

The Vercel project is connected to the GitHub repo via Vercel's built-in GitHub integration (not via GitHub Actions — there is no Vercel-related workflow file in `.github/workflows/`).

The Vercel project lives under **Vinit's personal Vercel account** (a free plan, with no Teams). Because of this:

- Only Vinit can push to `main` and have the build succeed and deploy to production. The Vercel GitHub integration runs the build under his account, and only commits authored/pushed by him on `main` produce a successful production deployment.
- Pushes to `main` from anyone else are **rejected** at the Vercel build step — there is no access for other GitHub users on this Vercel account, and the free plan has no Teams concept to share access.
- Pushes to non-`main` branches that are part of an open PR **do** produce Preview builds (see below). The "only Vinit can deploy" restriction applies to Production only.

The build command Vercel runs is the standard `next build` from `packages/frontend/package.json`. There is **no `convex deploy` step in the Vercel build**, so a Vercel build never modifies any Convex deployment.

### Preview deployments

Every push to a branch with an open PR triggers a Vercel **Preview** build:

- Each push produces a new Preview at a unique `*.vercel.app` URL, linked on the PR.
- The build is the same `next build` as production — there is no `convex deploy` step, so Previews never modify any Convex deployment.
- Previews use Vercel's **Preview**-scoped environment variables. Whatever `NEXT_PUBLIC_CONVEX_URL` is set to under the Preview scope is the Convex backend the Preview talks to. Verify this value in the Vercel dashboard before testing destructive flows on a Preview — if it points at production Convex, the Preview is reading and writing prod data.
- Previews build successfully for pushes from any collaborator, not just Vinit. The "only Vinit can deploy" constraint applies to Production only.

### Convex URL used by the production build

The Vercel production build reads `NEXT_PUBLIC_CONVEX_URL` from the Vercel project's Environment Variables (Production scope). It points to the production Convex deployment.

There is no shared "staging" Convex deployment. The project has exactly two kinds of Convex deployments today:

1. One **production** Convex deployment (deployed manually — see below).
2. One **dev** Convex deployment **per developer**, created locally by `npx convex dev`. These are not shared and are not used by Vercel.

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
2. Open a PR as normal.
3. When the PR merges to `main`, the `Release` workflow runs:
   - If there are pending changesets, it opens (or updates) a "Version Packages" PR that bumps `package.json` versions and updates `CHANGELOG.md`.
   - When that "Version Packages" PR is itself merged, the workflow publishes the new version of `@tars-inc/eval-lib` to npm.
4. Consumers (including this repo's `frontend` and `backend` packages) pick up the new version through the workspace `workspace:*` link locally; external consumers update via `pnpm up @tars-inc/eval-lib`.

The workflow only handles publishing the library. It does **not** deploy the frontend or the backend.

## End-to-end picture

```
 git push to main (by Vinit)
            │
            ▼
 Vercel GitHub integration
            │
            ▼
 Production build of packages/frontend
            │
            ▼
 Reads NEXT_PUBLIC_CONVEX_URL (Production scope)
            │
            ▼
 Convex production deployment
 (deployed manually via `npx convex deploy`)
```

Separately, on merge to `main`:

```
 main ──► .github/workflows/release.yml ──► Changesets ──► npm publish @tars-inc/eval-lib
```

## Common gotchas

- **Backend code merged to `main` but production not updated.** Convex production is only updated by someone running `npx convex deploy` locally. Merging to `main` does nothing on its own.
- **Someone other than Vinit pushed to `main` and the production site didn't update.** That's expected on the current Vercel setup — only Vinit's pushes produce a successful production deploy. Ask him to push (or pull and re-push) the commit.
- **`@tars-inc/eval-lib` not republished after a change.** If you change `packages/eval-lib/src` but forget to run `pnpm changeset`, the release workflow won't publish a new version. External consumers will keep getting the old version.

## Future work (not implemented today)

These are not part of the current deployment setup. They're listed here so the doc is honest about what is and isn't in place.

- Moving the Vercel project off Vinit's personal account onto a shared Team so anyone can deploy to production.
- A CI step that deploys Convex automatically on merge to `main`.
- A CI step that runs `pnpm -C packages/backend test` and `pnpm -C packages/frontend build` on PRs to catch breakage before Vercel does.

Open a GitHub issue if you want to drive any of these.
