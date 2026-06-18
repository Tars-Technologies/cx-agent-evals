# Prod deploy runbook — agents/evaluator rehaul cutover

This branch reshapes several tables. Two classes of change need handling at the
**prod** cutover (dev is already migrated and clean):

| Change | Tables | Handling |
|---|---|---|
| Type widened (`createdBy`/`userId` → `union(id, string)`) | `knowledgeBases`, `datasets`, `retrievers`, `generationJobs`, `experiments`, `experimentRuns`, `indexingJobs`, `crawlJobs` | **None** — union is non-breaking; legacy Clerk-string rows stay valid. |
| Tables **repurposed** (new required fields) | `annotations`, `failureModes`, `evaluators`, `conversationScenarios`, `conversationSimulations`, `scenarioGenJobs` | **Clear legacy rows** before pushing the strict schema (decision "b"). |
| Tables **dropped** | `evaluatorConfigs/Runs/Results/Sets`, `agentExperimentResults`, `failureModeQuestionMappings` | **None** — Convex doesn't validate undeclared tables; delete their data later at leisure. |

## Cutover steps (run against PROD)

> If prod has **no** rows in the repurposed tables (newer features may be unused),
> skip straight to a normal `convex deploy` — the strict schema pushes cleanly and
> nothing below is needed. Steps 1–5 are only required if a strict push is rejected.

1. **Relax validation temporarily.** In `convex/schema.ts`, pass `{ schemaValidation: false }`:
   ```ts
   export default defineSchema(
     { ...kbTables, ...agentTables, ...sharedTables },
     { schemaValidation: false },
   )
   ```
2. **Deploy** to prod (`convex deploy`). Succeeds despite legacy rows; the cleanup
   functions are now live.
3. **Inspect** (read-only):
   ```
   npx convex run migrations/clearLegacyEvalRows:countLegacy '{}' --prod
   ```
   If every table reports `legacy: 0`, skip to step 5.
4. **Clear legacy rows** (deletes ONLY rows missing the new required key; self-reschedules):
   ```
   npx convex run migrations/clearLegacyEvalRows:clearLegacy '{}' --prod
   ```
   Re-run `countLegacy` until all tables report `legacy: 0` (and `capped: false`).
5. **Re-enable validation.** Revert step 1 (remove the `{ schemaValidation: false }`
   argument) and **deploy** again. The strict schema now pushes cleanly.

## Notes
- `clearLegacy` only deletes legacy-shaped rows, so it is safe to re-run and will
  never touch rows created by the new feature.
- Legacy rows are the oldest in each table, so they are read/deleted before any new
  rows — the batched pass converges.
- The dropped tables (`evaluator*`, `agentExperimentResults`, `failureModeQuestionMappings`)
  can be emptied any time after cutover via the dashboard; they do not block deploy.
