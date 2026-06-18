## ADDED Requirements

### Requirement: Labeling WorkPool instance
The system SHALL create a `Workpool` instance backed by `components.labelingPool` with retry enabled and a bounded `maxParallelism`, mirroring the existing `generationPool` configuration.

#### Scenario: Pool is available
- **WHEN** the Convex backend is deployed
- **THEN** the `labelingPool` component SHALL be available via `components.labelingPool`

### Requirement: Start labeling against existing modes
The system SHALL provide a `startLabeling` mutation that loads the existing `failureModes` for the target `errorAnalysis`. If there are zero modes it SHALL fail with an explicit "no modes to label against" error. Otherwise it SHALL create an `agentLabelRuns` record with `status: "running"` and counters initialized to the cohort size, delete any prior `failureModeMemberships` whose `origin.kind === "agent"` for that analysis, enqueue one `labelOneSource` action per cohort member, and store the returned `workIds` on the run. It SHALL NOT discover, create, or modify any `failureModes`.

#### Scenario: Labels against the existing taxonomy
- **WHEN** `startLabeling` runs on an analysis with 4 existing failure modes and a 10-member cohort
- **THEN** it SHALL create a run with `total: 10`, enqueue 10 actions, store 10 `workIds`, and leave the 4 `failureModes` unchanged

#### Scenario: No modes is an error
- **WHEN** `startLabeling` runs on an analysis with zero failure modes
- **THEN** it SHALL fail with a "no modes to label against" error and create no run

#### Scenario: Re-run replaces only agent memberships
- **WHEN** `startLabeling` runs on an analysis that already has agent-origin and clustering-origin memberships
- **THEN** it SHALL delete only the `origin.kind === "agent"` memberships before fan-out and SHALL leave clustering/manual memberships intact

### Requirement: Per-source labeling action
The system SHALL provide a `labelOneSource` action (`"use node"`) that hydrates the conversation/transcript messages for one polymorphic `source` via `getMessagesForSource`, runs `runMultiDimJudge` once against the run's snapshot of failure modes, writes one `agentLabels` row (`overallPass` + `perMode` with reasoning), and writes one `failureModeMembership` (with `origin: {kind:"agent", runId}`) for each failing mode. It SHALL return a per-item result indicating success or a recorded error, and a single item's judge/parse error SHALL NOT abort the rest of the cohort.

#### Scenario: Failing modes produce memberships
- **WHEN** `labelOneSource` judges a source as failing modes A and C (passing B)
- **THEN** it SHALL write an `agentLabels` row with `overallPass: false` and SHALL create agent-origin memberships for A and C only

#### Scenario: All-pass writes no memberships
- **WHEN** a source passes every mode
- **THEN** it SHALL write an `agentLabels` row with `overallPass: true` and create no memberships

#### Scenario: Per-item error is isolated
- **WHEN** the judge call or parse fails for one source
- **THEN** that item SHALL be recorded as failed and the remaining cohort items SHALL continue

### Requirement: Labeling completion callback
The system SHALL provide an `onLabeled` mutation as the WorkPool `onComplete` callback that updates run counters via the shared `applyResult`/`counterPatch` helpers and, when all items have settled, finalizes the run: `status: "completed"` if there were no failures, `"failed"` if every item failed, otherwise `"completed_with_errors"`, setting `completedAt`.

#### Scenario: All items succeed
- **WHEN** the last item completes and no items failed
- **THEN** the run status SHALL be `"completed"` with `completedAt` set

#### Scenario: Some items failed
- **WHEN** all items settle but at least one failed
- **THEN** the run status SHALL be `"completed_with_errors"`

### Requirement: Cancel labeling
The system SHALL provide a `cancelLabeling` mutation that first sets the run status to `"canceling"`, then iterates the run's stored `workIds` and calls `pool.cancel` for each, so canceling one run does not affect other runs sharing the pool.

#### Scenario: Cancel mid-run
- **WHEN** a user cancels a labeling run with 5/10 items processed
- **THEN** the status SHALL be set to `"canceling"` first, only this run's pending items SHALL be canceled, and the run SHALL reach `"canceled"` when items finish
