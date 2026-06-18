## ADDED Requirements

### Requirement: Per-dimension judge prompt
The system SHALL extend `buildJudgePrompt` so that when `llmJudgeConfig.outputFormat === "per_dimension"`, the prompt instructs the model to return a single JSON object keyed by a stable per-dimension `modeKey` (`m0`, `m1`, …, assigned by dimension index), where each value is `{ "answer": "pass" | "fail", "reasoning": "<one or two sentences>" }`. The builder SHALL return the `modeKey → failureModeId` map alongside the prompt. Raw `failureModes` ids SHALL NOT appear in the prompt text.

#### Scenario: Per-dimension prompt requests a keyed object
- **WHEN** `buildJudgePrompt` is called with an evaluator whose `outputFormat` is `"per_dimension"` and three dimensions
- **THEN** the system prompt SHALL describe an output object with keys `m0`, `m1`, `m2`, each requiring an `answer` and `reasoning`, and SHALL return a map associating each key to its dimension's `failureModeId`

#### Scenario: Aggregate path is unchanged
- **WHEN** `buildJudgePrompt` is called with `outputFormat === "aggregate"` (or absent)
- **THEN** it SHALL produce the existing single `{ "answer", "reasoning" }` fail-if-any prompt with no per-dimension keys

### Requirement: Multi-verdict parser
The system SHALL provide a pure `parseMultiJudge(content, modeKeys)` function in `evaluator/parseJudge.ts` (no `"use node"`) that strict-JSON-parses the model output and returns, for every expected `modeKey`, a `{ verdict: "pass" | "fail", reasoning: string }`. It SHALL normalize `answer`/`verdict` values (`pass`/`yes` → pass, `fail`/`no` → fail) per entry and SHALL throw if any expected `modeKey` is missing or its verdict is unrecognized, refusing to guess.

#### Scenario: Valid multi-verdict parses
- **WHEN** the content is `{"m0":{"answer":"fail","reasoning":"x"},"m1":{"answer":"pass","reasoning":"y"}}` and `modeKeys` is `["m0","m1"]`
- **THEN** it SHALL return per-key verdicts `m0 → fail` and `m1 → pass` with their reasoning

#### Scenario: Missing mode throws
- **WHEN** the content omits an expected `modeKey` or gives an unrecognized answer
- **THEN** `parseMultiJudge` SHALL throw rather than return a partial or guessed result

### Requirement: Multi-dimensional judge run
The system SHALL provide `runMultiDimJudge(client, modes, messages, fewShot)` that builds the per-dimension prompt, calls the injected `JudgeLlmClient` once, parses via `parseMultiJudge`, and returns `{ overallPass: boolean, perMode: Array<{ failureModeId, pass, reasoning }> }`. `overallPass` SHALL be true if and only if every mode's verdict is pass. A client or parse error SHALL propagate (no silent pass).

#### Scenario: Overall pass requires all modes pass
- **WHEN** the judge returns pass for every mode
- **THEN** `overallPass` SHALL be true and each `perMode` entry SHALL carry `pass: true`

#### Scenario: Any failing mode fails overall
- **WHEN** the judge returns fail for at least one mode
- **THEN** `overallPass` SHALL be false and the failing modes SHALL be identifiable in `perMode`

#### Scenario: Judge error is not a silent pass
- **WHEN** the client throws or the response is unparseable
- **THEN** `runMultiDimJudge` SHALL throw so the caller records an error
