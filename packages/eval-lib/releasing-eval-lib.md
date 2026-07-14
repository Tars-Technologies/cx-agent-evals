# Releasing `@tars-inc/eval-lib`

`@tars-inc/eval-lib` (in `packages/eval-lib/`) is the only publishable package in this
repo. Releases are driven by [Changesets](https://github.com/changesets/changesets) and
automated by `.github/workflows/release.yml`. The backend (`@rag-eval/backend`) and
`frontend` are ignored by Changesets (`.changeset/config.json` → `ignore`) and are never
published to npm.

## When do we release, and what kind?

We currently ship two kinds of release. **We do not ship major releases right now** — see
below.

| Bump      | Ship it when...                                                                 | Example |
|-----------|----------------------------------------------------------------------------------|---------|
| **patch** | Bug fix, dependency bump, internal refactor — no change to how consumers use the library. | Fix a scoring bug in `f1`; bump `openai` to patch a vuln. |
| **minor** | Anything else — new functionality, changed behavior, even a breaking change to the public API. | Add a new chunker; add an optional config field; rename or remove an export. |
| **major** | Not used right now (see below). | — |

If you're not sure whether something is patch or minor, ask: *"does this change what a
consumer's existing code does, without them changing anything?"* If yes, it's at least a
minor bump — regardless of whether the change is additive or breaking.

### Why no major releases yet

`@tars-inc/eval-lib` is on a `0.x` version, which is still "initial development" under
[semver](https://semver.org/#spec-item-4). The spec is explicit that during `0.x`, the
public API should not be considered stable, and *anything may change at any time* —
including breaking changes — without requiring a major bump. Major is reserved for `1.0.0`,
the point at which we commit to a stable API.

Practically: minor bumps can contain breaking changes while we're on `0.x`. Just call it
out clearly in the changeset/changelog entry so consumers aren't surprised. Once we cut
`1.0.0`, breaking changes move to major bumps and this caveat goes away.

### Industry practices worth following as we mature

- **Follow semver strictly once stable**: patch = no consumer-visible change, minor =
  additive/backwards-compatible, major = anything that requires a consumer code change
  (removed/renamed exports, changed function signatures, changed default behavior).
- **Deprecate before removing**: mark APIs `@deprecated` with a migration note for at least
  one minor release before removing them in a major.
- **One changeset per consumer-visible change**, not per PR — write the summary for the
  person reading the changelog, not for a teammate reviewing the diff.
- **Keep a CHANGELOG a human would want to read**: group by bump type, lead with the "why"
  for breaking or notable changes, link to migration notes if applicable.
- **Batch dependency bumps** into patch releases on a regular cadence (e.g. weekly/Dependabot)
  rather than ad hoc, so consumers see predictable, low-risk patch releases instead of
  major-adjacent surprises.
- **Never mix a breaking change with unrelated feature work** in the same release — makes
  it hard for consumers to evaluate the upgrade risk.

## TL;DR

1. In your feature PR, run `pnpm changeset` and commit the generated `.changeset/*.md` file.
2. Merge the PR to `main`.
3. The Release workflow opens a **"chore: version packages"** PR that bumps the version and
   updates the changelog.
4. Merging that PR **publishes the new version to npm**.

A release happens when — and only when — the "version packages" PR is merged. Merging a
normal feature PR that contains a changeset does **not** publish; it just queues the bump.

## Step 1 — Add a changeset (in the feature PR)

Any change to `packages/eval-lib/` that should ship to consumers needs a changeset:

```bash
pnpm changeset
```

- Select `@tars-inc/eval-lib`.
- Pick the bump type (see the table above):
  - **patch** — bug fixes, dependency updates, internal changes with no API change.
  - **minor** — new backwards-compatible features, and (for now, see above) breaking changes.
  - **major** — not used currently; see "Why no major releases yet" above.
- Write a short summary. It becomes the `CHANGELOG.md` entry, so write it for consumers. If
  the change breaks existing usage, say so explicitly and describe the migration.

This creates a file like `.changeset/tame-otters-cry.md`. Commit it with your change:

```bash
git add .changeset/*.md
git commit -m "chore: add changeset"
```

Changes that don't affect the published package (backend/frontend/docs/CI only) don't need
a changeset. Skipping one is fine — it just means no release is queued.

## Step 2 — Merge to `main`

When your PR merges, `release.yml` runs on `push` to `main` and invokes `changesets/action`.

Its behaviour depends on whether there are pending changeset files:

- **Pending changesets exist** → it runs `pnpm changeset version`, which bumps
  `packages/eval-lib/package.json`, writes `CHANGELOG.md`, and deletes the consumed
  changeset files. The result is pushed as a PR titled **"chore: version packages"**.
- **No pending changesets, but a version bump is on `main`** → it runs
  `pnpm changeset publish`, which builds and publishes to npm.

## Step 3 — Merge the "version packages" PR to publish

Review the auto-generated **"chore: version packages"** PR (verify the new version and the
changelog), then merge it. That merge re-triggers `release.yml`; this time there are no
pending changesets, so it runs `pnpm changeset publish` and pushes the release to npm.

The published version is whatever is in `packages/eval-lib/package.json` at that point.
`prepublishOnly` (and the workflow's build step) run `tsup` first, so `dist/` is always
rebuilt from source before publish.

## What the release workflow needs

- Publishing uses npm OIDC / trusted publishing (no long-lived npm token). Auth errors on
  publish → check the trusted-publisher config on npmjs (or `NODE_AUTH_TOKEN` secret).
- `GITHUB_TOKEN` (default) opens the "version packages" PR.

## Verifying a release

- npm: `npm view @tars-inc/eval-lib version` should show the new version.
- Git: a `chore: version packages` commit lands on `main`, and `CHANGELOG.md` in the
  package has the new entry.

## Manual / dry run

- `pnpm changeset status` — see what would be released.
- `pnpm -C packages/eval-lib build` — reproduce the publish build locally.
- `release.yml` also supports `workflow_dispatch` if you need to re-run it manually.
