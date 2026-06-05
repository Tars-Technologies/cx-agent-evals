---
"@tars-inc/eval-lib": minor
---

Add an optional `maxConcurrency` to `runLangSmithExperiment`, forwarded to LangSmith `evaluate()`. When omitted, behavior is unchanged (sequential). This lets callers parallelize per-example retrieval to buy headroom against long-running evaluation limits (issue #103, Fix B step 1).
