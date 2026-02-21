## ADDED Requirements

### Requirement: Two-phase execution layout
The right panel SHALL display experiment execution as two vertically stacked phase cards connected by a visual flow indicator (vertical line with arrow). Phase 1 is "Indexing" and Phase 2 is "Evaluation". Each phase card SHALL show its own status indicator.

#### Scenario: Idle state shows both phases pending
- **WHEN** no experiment is running
- **THEN** both phase cards SHALL show ○ (pending) status with descriptive placeholder text

#### Scenario: Visual flow between phases
- **WHEN** the execution panel is visible
- **THEN** a vertical connector (line with downward arrow) SHALL visually link Phase 1 to Phase 2

### Requirement: Phase 1 Indexing status
Phase 1 SHALL display the indexing progress with states: pending (○), running (● with progress bar and chunk count), complete (✓ with chunk count and inspection link), and error (✗ with error message).

#### Scenario: Indexing running
- **WHEN** the backend job phase is "indexing"
- **THEN** Phase 1 SHALL show ● RUNNING status with a progress bar and message (e.g., "Embedding chunks... (78/120)")

#### Scenario: Indexing complete
- **WHEN** the backend job phase progresses past indexing
- **THEN** Phase 1 SHALL show ✓ COMPLETE status with the number of chunks indexed

### Requirement: Index inspection link
When indexing is complete, Phase 1 SHALL display a "View in Convex Dashboard" link that opens the Convex dashboard filtered to the relevant knowledge base's document chunks.

#### Scenario: Dashboard link shown after indexing
- **WHEN** indexing completes successfully
- **THEN** Phase 1 SHALL display a "View in Convex Dashboard →" link styled as `text-accent` that opens in a new tab

### Requirement: Auto-start experiment toggle
The execution panel SHALL include a checkbox labeled "Auto-start experiment after indexing" that is checked by default. When checked, the experiment evaluation SHALL begin automatically after indexing completes. When unchecked, a "Run Experiment" button SHALL appear in Phase 2 after indexing completes.

#### Scenario: Auto-start enabled (default)
- **WHEN** user starts the pipeline with auto-start checked
- **THEN** Phase 2 SHALL show "Will start automatically after indexing completes" while indexing runs, and SHALL transition to RUNNING when indexing finishes

#### Scenario: Auto-start disabled
- **WHEN** user starts the pipeline with auto-start unchecked
- **THEN** after indexing completes, Phase 2 SHALL show a "Run Experiment" button that the user must click to begin evaluation

#### Scenario: User inspects index before running
- **WHEN** auto-start is unchecked and indexing completes
- **THEN** user SHALL be able to click "View in Convex Dashboard" to inspect the index, then click "Run Experiment" when ready

### Requirement: Phase 2 Evaluation status
Phase 2 SHALL display the evaluation progress with states: pending/waiting (○), running (● with progress bar and question count), complete (✓ with metric scores), and error (✗ with error message).

#### Scenario: Evaluation running
- **WHEN** the backend job phase is "evaluating"
- **THEN** Phase 2 SHALL show ● RUNNING status with a progress bar and message (e.g., "Evaluating... (32/50 questions)")

#### Scenario: Evaluation complete with scores
- **WHEN** the experiment completes successfully
- **THEN** Phase 2 SHALL show ✓ COMPLETE with a 2×2 grid of metric scores (formatted to 3 decimal places) and a "View in LangSmith →" link

#### Scenario: Evaluation error
- **WHEN** the experiment fails during evaluation
- **THEN** Phase 2 SHALL show ✗ ERROR with the error message in red

### Requirement: Start Pipeline button
The execution panel SHALL provide a "Start Pipeline" button that initiates the experiment workflow (indexing + optional auto-start evaluation). The button SHALL be disabled when no dataset is selected, no pipeline config is set, or an experiment is already running.

#### Scenario: Button starts indexing
- **WHEN** user clicks "Start Pipeline" with valid config and dataset
- **THEN** the backend experiment mutation SHALL be called and Phase 1 SHALL transition to RUNNING

#### Scenario: Button disabled during execution
- **WHEN** an experiment is in progress (either indexing or evaluating)
- **THEN** the Start Pipeline button SHALL be disabled and show a spinner with "Running..."

#### Scenario: Button disabled without config
- **WHEN** no pipeline configuration is set
- **THEN** the Start Pipeline button SHALL be disabled
