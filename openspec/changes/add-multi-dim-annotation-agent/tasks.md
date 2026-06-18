## 1. Schema & Infrastructure (additive, backward compatible)

- [ ] 1.1 Add `agentLabelRuns` table to `schemas/agent.schema.ts` (orgId, agentId, errorAnalysisId, model, status, counters {total, processed, failed, skipped}, workIds[], createdAt, completedAt; indexes by_org, by_analysis)
- [ ] 1.2 Add `agentLabels` table (orgId, runId, errorAnalysisId, source polymorphic, overallPass, perMode: [{failureModeId, pass, reasoning}], createdAt; indexes by_run, by_analysis, by_conversation, by_transcript)
- [ ] 1.3 Add optional `origin` discriminator to `failureModeMemberships` (`{kind:"clustering"} | {kind:"manual"} | {kind:"agent", runId}`), absent = legacy/non-agent
- [ ] 1.4 Register `labelingPool` in `convex.config.ts` (maxParallelism, retry defaults mirroring `generationPool`)

## 2. Multi-Dimensional Judge Verdict (pure, TDD-first)

- [ ] 2.1 Write failing unit tests for `parseMultiJudge(content, modeKeys)` — valid multi-verdict maps each modeKey to pass/fail+reasoning; missing/garbled mode throws; pass/yes & fail/no normalization per entry
- [ ] 2.2 Implement `parseMultiJudge` in `evaluator/parseJudge.ts` (pure, no "use node"); reuse `extractVerdict` per entry
- [ ] 2.3 Extend `buildJudgePrompt` in `evaluator/llmJudge.ts`: when `outputFormat === "per_dimension"`, request `{ "<modeKey>": {answer, reasoning} }`; assign stable `modeKey` (m0, m1, …) per dimension and return the `modeKey → failureModeId` map; preserve `aggregate` path unchanged
- [ ] 2.4 Add `runMultiDimJudge(client, modes, messages, fewShot)` returning `{ overallPass, perMode: [{failureModeId, pass, reasoning}] }`; derive overallPass = every mode passes; keep injectable `JudgeLlmClient`
- [ ] 2.5 Unit test `runMultiDimJudge` with a mocked client returning a canned multi-verdict; assert per-mode mapping + overall derivation; assert a judge error surfaces (no silent pass)

## 3. Failure-Mode Labeling Run (cohort orchestration)

- [ ] 3.1 `startLabeling` mutation: load existing `failureModes` for the analysis (error if zero), create `agentLabelRuns` (status "running"), delete prior `origin.kind==="agent"` memberships for the analysis, enqueue one `labelOneSource` per cohort member, store `workIds`
- [ ] 3.2 `labelOneSource` action ("use node"): hydrate messages via `evaluator/sources.ts` `getMessagesForSource`, call `runMultiDimJudge` once, write `agentLabels` row + a `failureModeMembership` (origin agent+runId) per failing mode; return per-item result; record parse/judge errors without aborting the cohort
- [ ] 3.3 `onLabeled` onComplete mutation: use shared `applyResult`/`counterPatch`; finalize run when all items settle (status completed / completed_with_errors / failed); set completedAt
- [ ] 3.4 `cancelLabeling` mutation: set status "canceling" first, then `pool.cancel` per stored workId
- [ ] 3.5 Queries: `getRun`, `listRuns`, `getRunInternal`, `labelsByAnalysis`, mode-snapshot query for the run
- [ ] 3.6 Integration test (convex-test): small cohort with N modes → every member gets an `agentLabels` row, failing modes produce agent-origin memberships, run finalizes with correct counters; mocked judge client

## 4. Agent-Label Validation

- [ ] 4.1 Query overlapping sources (have both an `agentLabels` row and a human `annotations`/`evaluatorLabels` signal) per mode
- [ ] 4.2 Compute per-mode TPR/TNR/agreement + Wilson CI reusing `evaluator/metrics.ts`; flag modes meeting the ≥85% TPR/TNR bar as "trustworthy"
- [ ] 4.3 Unit test the agreement computation against a fixture with known confusion counts

## 5. Frontend (additive)

- [ ] 5.1 Confirm the failure-modes view renders agent-origin memberships unchanged
- [ ] 5.2 Add an "Run agent labeling" trigger on the error-analysis view (calls `startLabeling`, shows run progress from `agentLabelRuns`)
- [ ] 5.3 Add an agreement/validation surface showing per-mode TPR/TNR and disagreements

## 6. Verification

- [ ] 6.1 `pnpm -C packages/eval-lib test` and `pnpm -C packages/backend test` green
- [ ] 6.2 `pnpm typecheck:backend` and frontend production build green
- [ ] 6.3 End-to-end on a known-bad cohort: modes labeled, memberships + agreement render; re-run replaces only agent-origin memberships (clustering/manual untouched)
