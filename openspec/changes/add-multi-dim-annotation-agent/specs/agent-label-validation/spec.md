## ADDED Requirements

### Requirement: Per-mode agreement against human ground truth
The system SHALL provide a query that, for a given `errorAnalysis`, identifies sources that have BOTH an `agentLabels` row and a human signal (an `annotations` row or an `evaluatorLabels` entry) and computes, per failure mode, true-positive-rate (TPR) and true-negative-rate (TNR) with Wilson confidence intervals, reusing `evaluator/metrics.ts`. A mode whose agent verdicts meet TPR ≥ 0.85 AND TNR ≥ 0.85 SHALL be reported as "trustworthy".

#### Scenario: Agreement is computed where both labels exist
- **WHEN** 12 sources have both agent labels and human annotations across 3 modes
- **THEN** the query SHALL return per-mode TPR/TNR with Wilson CIs computed only over the overlapping sources

#### Scenario: Trustworthy flag
- **WHEN** a mode's agent labels reach TPR ≥ 0.85 and TNR ≥ 0.85 over the overlap
- **THEN** that mode SHALL be flagged trustworthy; modes below either bar SHALL NOT

#### Scenario: No overlap yields no agreement
- **WHEN** a mode has no source with both an agent and a human label
- **THEN** the query SHALL report that mode as having insufficient overlap rather than a fabricated rate

### Requirement: Human labels remain ground truth
Agent verdicts SHALL be stored only in `agentLabelRuns`/`agentLabels` and as `origin.kind === "agent"` memberships. The system SHALL NOT write, modify, or delete any `annotations` row as part of labeling or validation.

#### Scenario: Annotations untouched
- **WHEN** an agent labeling run and validation complete over a cohort that already has human annotations
- **THEN** every pre-existing `annotations` row SHALL be byte-for-byte unchanged
