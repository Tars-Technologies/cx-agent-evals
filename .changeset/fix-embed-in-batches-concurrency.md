---
"@tars-inc/eval-lib": patch
---

Fix `embedInBatches` to use controlled concurrency instead of unbounded parallelism.

Large corpora could trigger OpenAI rate-limit errors during embedding, causing
generation to fail silently. Embedding batches are now processed with a concurrency
limit of 3, preventing rate-limit bursts while keeping latency practical.
