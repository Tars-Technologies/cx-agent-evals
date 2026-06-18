## MODIFIED Requirements

### Requirement: LLM judge output format
The LLM judge SHALL honor `llmJudgeConfig.outputFormat`. For `"aggregate"` (the existing default behavior), all dimensions are evaluated in a single call with model-side fail-if-any — the conversation PASSES only if every dimension is satisfied — and the response is the single `{ "answer", "reasoning" }` object parsed by `parseJudgeResponse`. For `"per_dimension"`, the judge SHALL request and parse a per-dimension keyed verdict object (see the `multi-dim-judge-verdict` capability) and expose per-dimension pass/fail rather than collapsing to one verdict. Existing evaluators (which use `"aggregate"`) SHALL be unaffected.

#### Scenario: Aggregate evaluator behavior preserved
- **WHEN** an existing evaluator with `outputFormat === "aggregate"` is run
- **THEN** it SHALL produce the single fail-if-any verdict exactly as before, with no change in prompt or parsing

#### Scenario: Per-dimension evaluator exposes per-mode verdicts
- **WHEN** an evaluator (or labeling run) with `outputFormat === "per_dimension"` is run against multiple dimensions
- **THEN** the judge SHALL return a verdict per dimension and SHALL NOT collapse them to a single answer
