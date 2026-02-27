## ADDED Requirements

### Requirement: Generation WorkPool component registration
The system SHALL register an additional `@convex-dev/workpool` component named `generationPool` in `convex.config.ts` via `app.use(workpool, { name: "generationPool" })`.

#### Scenario: Component registered
- **WHEN** the Convex backend is deployed
- **THEN** the `generationPool` component SHALL be available via `components.generationPool`

### Requirement: Experiment WorkPool component registration
The system SHALL register an additional `@convex-dev/workpool` component named `experimentPool` in `convex.config.ts` via `app.use(workpool, { name: "experimentPool" })`.

#### Scenario: Component registered
- **WHEN** the Convex backend is deployed
- **THEN** the `experimentPool` component SHALL be available via `components.experimentPool`
