## ADDED Requirements

### Requirement: WorkPool component registration
The system SHALL register a `@convex-dev/workpool` component named `indexingPool` in `convex.config.ts`. The package `@convex-dev/workpool` SHALL be added as a dependency in `packages/backend/package.json`.

#### Scenario: Component is registered and available
- **WHEN** the Convex backend is deployed
- **THEN** the `indexingPool` component SHALL be available for use in mutations and actions via `components.indexingPool`

### Requirement: WorkPool default configuration
The system SHALL configure the `indexingPool` WorkPool with the following defaults: `maxParallelism: 10`, `retryActionsByDefault: true`, `defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2000, base: 2 }`. This provides exponential backoff with jitter (2s, 4s, 8s, 16s) and up to 5 attempts per document.

#### Scenario: Retry with exponential backoff
- **WHEN** an `indexDocument` action fails on the first attempt
- **THEN** WorkPool SHALL retry after approximately 2 seconds (plus jitter), then 4 seconds, then 8 seconds, up to 5 total attempts

#### Scenario: Terminal failure after max retries
- **WHEN** an `indexDocument` action fails on all 5 attempts
- **THEN** WorkPool SHALL fire the onComplete callback with `result.kind === "failed"` and the last error message

### Requirement: Dynamic parallelism per tier
The system SHALL support adjusting the WorkPool's `maxParallelism` at runtime based on the organization's tier. The `startIndexing` mutation SHALL set the parallelism before enqueueing documents: Free tier = 3, Pro tier = 10, Enterprise tier = 20. The adjustment SHALL be performed via `ctx.runMutation(components.indexingPool.config.update, { maxParallelism })`.

#### Scenario: Free tier parallelism
- **WHEN** a free-tier org starts indexing
- **THEN** the WorkPool maxParallelism SHALL be set to 3 before documents are enqueued

#### Scenario: Enterprise tier parallelism
- **WHEN** an enterprise-tier org starts indexing
- **THEN** the WorkPool maxParallelism SHALL be set to 20 before documents are enqueued

### Requirement: WorkPool crash recovery
The system SHALL rely on WorkPool's built-in crash recovery mechanisms: Layer 1 (Convex `_scheduled_functions` tracking for action failures and timeouts), Layer 2 (main loop completion handling for immediate failure detection), and Layer 3 (30-minute healthcheck cron for stale state detection). No custom watchdog or time-budget pattern SHALL be implemented.

#### Scenario: Action times out at 10 minutes
- **WHEN** an `indexDocument` action is killed by the Convex 10-minute timeout
- **THEN** WorkPool SHALL detect the failure and retry the action with exponential backoff, and the two-phase checkpoint SHALL ensure no work is repeated

#### Scenario: WorkPool main loop stalls
- **WHEN** the WorkPool main loop stops processing due to a platform hiccup
- **THEN** the 30-minute healthcheck cron SHALL force-kick the pool to resume processing
