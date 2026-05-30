# Contributing to cx-agent-evals

🙌 First of all, thanks for checking out the project and taking the time to contribute!

We at Tars welcome your contributions. The following is a set of guidelines for
contributing to cx-agent-evals, which is hosted in the
[Tars Organization](https://github.com/Tars-Technologies) on GitHub. These are
just guidelines, not rules, so use your best judgment and feel free to propose
changes to this document in a pull request.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
1. [Well I just have a question](#well-i-just-have-a-question)
1. [How Can I Contribute?](#how-can-i-contribute)
    - [Reporting Bugs](#reporting-bugs)
    - [Suggesting Enhancements](#suggesting-enhancements)
    - [Pull Requests](#pull-requests)
1. [Development Setup](#development-setup)

## Code of Conduct

Please refer to our [Code of Conduct](./CODE_OF_CONDUCT.md) for details on how we
expect everyone in the community to interact.

## Well I just have a question

If you have a question, you can open an issue.

## How Can I Contribute?

The project is in its early stages and we are always changing stuff around, so
contributions of all sizes are welcome.

### Reporting Bugs

To report a bug, open a new issue and pick the **Bug report** template from the
issue chooser. Fill in as much information as possible (expected vs actual
behavior, steps to reproduce, screenshots, and any relevant context); the more
detail, the faster we can help.

A few notes:

- Check first whether it's already reported in the issues.
- Make sure you're on the latest commit before reporting.
- If you know how to fix it, you're welcome to open a pull request.
- **Using an AI agent to draft the issue?** Use the agent-friendly Markdown
  templates in [`.github/agent-issue-templates/`](./.github/agent-issue-templates)
  (`bug_report.md`) instead of the web chooser.
- If you think it's a security issue, please don't open an issue; instead follow
  [SECURITY.md](./SECURITY.md) and report it privately.

### Suggesting Enhancements

To suggest an enhancement, open a new issue and pick the **Feature request**
template from the issue chooser. Make sure you:

1. Check if it's already suggested in the issues.
2. Give it a proper title and a clear description of the enhancement.

If you're drafting the issue with an AI agent, use
[`.github/agent-issue-templates/feature_request.md`](./.github/agent-issue-templates)
instead.

### Pull Requests

The process described here has several goals:

- Maintain the project's quality
- Fix problems that are important to users
- Engage the community in working toward the best possible project
- Enable a sustainable system for the maintainers to review contributions

To open a pull request:

1. [Fork](https://docs.github.com/en/get-started/quickstart/fork-a-repo) the
   repository and create your branch from `main`.
2. Make your changes, keeping the PR focused; one logical change per PR is easier
   to review.
3. Write a clear description: what changed, why, and how to verify it. Link any
   related issue.
4. Add a changeset if you touched `eval-lib` (see [Development Setup](#development-setup)).
5. Make sure tests and checks pass.
6. Open the pull request against `main` in this repository.

We use [Conventional Commits](https://www.conventionalcommits.org/) style for
commit messages, e.g. `fix(scripts): ...`, `docs: ...`, `feat(eval-lib): ...`.
Keep the subject short and in the imperative mood.

While the prerequisites above must be satisfied prior to having your pull request
reviewed, the reviewer(s) may ask you to complete additional design work, tests,
or other changes before your pull request can ultimately be accepted.

## Development Setup

This is a pnpm workspace monorepo (eval-lib, backend, frontend). For the full
local setup (Convex, Clerk, environment variables) see **[SETUP.md](./SETUP.md)**.

The short version:

```bash
sfw pnpm install   # Socket Firewall recommended; plain `pnpm install` works too
pnpm build         # build eval-lib, which backend and frontend depend on
```

**Development workflow**

- After editing `packages/eval-lib/src/`, run `pnpm build` and restart the
  Next.js dev server (Turbopack caches resolved modules).
- Backend changes in `packages/backend/convex/` are hot-reloaded by
  `pnpm dev:backend`.

See [SETUP.md](./SETUP.md#common-commands) for the full command list.

**Tests and checks**

```bash
pnpm test                         # eval-lib unit tests
pnpm -C packages/backend test     # backend (convex-test) integration tests
pnpm typecheck                    # typecheck eval-lib
pnpm typecheck:backend            # typecheck backend
pnpm lint                         # biome lint across the repo
pnpm format                       # biome auto-format
```

**Changesets (required for eval-lib changes)**

`@tars-inc/eval-lib` is published to npm via
[Changesets](https://github.com/changesets/changesets). If your PR changes
anything under `packages/eval-lib/src/`, add a changeset. A changeset is just a
markdown file in `.changeset/` that records the bump type and a summary.

The easiest way is the interactive CLI, which writes the file for you (with a
random name):

```bash
pnpm changeset
```

Or create the file by hand, e.g. `.changeset/short-summary.md`:

```markdown
---
"@tars-inc/eval-lib": patch
---

Short summary of what changed.
```

Pick the bump type (`patch` / `minor` / `major`) and commit the file in
`.changeset/`. On push to `main`, the release workflow (`.github/workflows/release.yml`)
runs `changeset version` and `changeset publish` to version and publish the
package. Without a changeset, no new version is published. Changes that only touch
the backend or frontend don't need one (they're in the changeset `ignore` list).
