# Deployment

> **Note:** A better CI/CD flow is in the works, so the details below can change.

This document describes how `cx-agent-evals` is deployed today and what each push
to GitHub does. If you are looking for first-time local setup instead, see
[SETUP.md](./SETUP.md).

## Terminology

- **Member**: someone with **write access** to the repository. Members push
  branches directly to the repo.
- **External contributor**: someone without write access. They work from a
  [fork](./CONTRIBUTING.md#pull-requests) and open pull requests.

## Deployment surfaces

The project has three independently-deployed surfaces:

| Surface | What it is | Where it lives | How it deploys |
|---|---|---|---|
| **Frontend** | The Next.js app in `packages/frontend` | Vercel | Preview on every branch push; Production on merge to `main` |
| **Backend** | The Convex functions in `packages/backend/convex` | Convex | A connected preview deployment per branch; the production deployment on merge to `main` |
| **`@tars-inc/eval-lib`** | The TypeScript library in `packages/eval-lib` | npm registry | On merge to `main` via [Changesets](https://github.com/changesets/changesets) and `.github/workflows/release.yml` |

## Preview deployments (branch pushes)

When a **member** pushes to **any** branch:

- Each push produces a **new Vercel preview deployment** with its own unique
  `*.vercel.app` URL, linked on the PR.
- The preview is wired to a **connected Convex preview deployment** and a
  **connected Clerk instance**, so the whole stack (frontend, backend, auth) is
  exercised in isolation from production.
- Those connected Convex and Clerk preview environments are **per branch**, so
  they are reused across commits on the same branch even though each push gets a
  new Vercel URL.

For **external contributors** (fork-based PRs), preview builds do **not** run
automatically. A member of the **`tars-deployment`** team must approve the run
first. External contributors have no direct access to any deployment.

## Production (merge to `main`)

When a PR is merged to `main`:

- Vercel builds and deploys the **Production** frontend.
- The **production Convex deployment** is updated as part of the flow (functions
  and schema), connected to the **production Clerk instance**.
- The frontend production build talks to the production Convex deployment and the
  production Clerk instance.

So a merge to `main` updates the live app end to end: frontend, backend, and auth.

### Manual Convex deploy (discouraged)

It is still technically possible to push the backend to production by hand, if you
have admin-level access to the Convex project:

```bash
pnpm deploy:backend     # runs `convex deploy` in packages/backend
# or, equivalently:
cd packages/backend && npx convex deploy
```

**This is discouraged and should be avoided.** It deploys whatever is in your local
working tree (not what's on `main`) and bypasses the normal merge-to-`main` flow,
which can leave production out of sync with the repository. Prefer merging to
`main` and letting the pipeline deploy.

## `@tars-inc/eval-lib` (npm)

The library is published to npm via [Changesets](https://github.com/changesets/changesets).
The workflow is in [`.github/workflows/release.yml`](./.github/workflows/release.yml)
and runs on every push to `main`.

### Day-to-day flow

1. While changing `packages/eval-lib`, add a changeset (`pnpm changeset`, or write
   the file by hand) recording the version bump and a short summary. Commit the
   generated file in `.changeset/`. See [CONTRIBUTING.md](./CONTRIBUTING.md#development-setup).
2. Open a PR as normal.
3. When the PR merges to `main`, the `Release` workflow runs:
   - If there are pending changesets, it opens (or updates) a "Version Packages" PR
     that bumps `package.json` versions and updates `CHANGELOG.md`.
   - When that "Version Packages" PR is merged, the workflow publishes the new
     version of `@tars-inc/eval-lib` to npm.
4. The workspace `frontend` and `backend` packages pick up the new version through
   the `workspace:*` link locally; external consumers update via
   `pnpm up @tars-inc/eval-lib`.

The release workflow only publishes the library. It does not deploy the frontend or
the backend.

## End-to-end picture

```text
 member pushes any branch
            │
            ▼
 Vercel Preview  ──connected──►  Convex preview + Clerk preview
 (new URL per push; Convex/Clerk reused per branch)


 PR merged to main
            │
            ├──►  Vercel Production  ──connected──►  Convex prod + Clerk prod
            │
            └──►  .github/workflows/release.yml ──► Changesets ──► npm publish @tars-inc/eval-lib
```

## Common gotchas

- **External contributor's preview didn't build.** That's expected. A
  `tars-deployment` team member has to approve the run for fork-based PRs.
- **Manually deployed Convex and now prod doesn't match `main`.** Manual
  `convex deploy` ships your local tree, not `main`. Re-merge or redeploy from a
  clean checkout of `main`. Better: avoid manual deploys (see above).
- **`@tars-inc/eval-lib` not republished after a change.** If you changed
  `packages/eval-lib/src` but didn't add a changeset, the release workflow won't
  publish a new version, and external consumers keep getting the old one.
