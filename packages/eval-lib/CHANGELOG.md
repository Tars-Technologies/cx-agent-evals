# @tars-inc/eval-lib

## 0.1.2

### Patch Changes

- 999af58: Fix `embedInBatches` to use controlled concurrency instead of unbounded parallelism.

  Large corpora could trigger OpenAI rate-limit errors during embedding, causing
  generation to fail silently. Embedding batches are now processed with a concurrency
  limit of 3, preventing rate-limit bursts while keeping latency practical.

## 0.1.1

### Patch Changes

- e6b3638: Rewrite the readme to accurately reflect package scope and exports
