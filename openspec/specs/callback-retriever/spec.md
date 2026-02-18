## Purpose

Callback-based retriever implementation that allows external systems (e.g., Convex) to plug into eval-lib's experiment runner without eval-lib knowing the details of the retrieval backend.

## Requirements

### Requirement: CallbackRetriever class
The system SHALL provide a `CallbackRetriever` class in `eval-lib/src/experiments/callback-retriever.ts` that implements the `Retriever` interface. It SHALL accept a `CallbackRetrieverConfig` with `name: string`, `retrieveFn: (query: string, k: number) => Promise<PositionAwareChunk[]>`, optional `initFn: (corpus: Corpus) => Promise<void>` (default: no-op), and optional `cleanupFn: () => Promise<void>` (default: no-op).

#### Scenario: Construct with required fields
- **WHEN** creating `new CallbackRetriever({ name: "my-retriever", retrieveFn: async (q, k) => [...] })`
- **THEN** the retriever SHALL have `name` equal to `"my-retriever"`, `init()` SHALL be a no-op, and `cleanup()` SHALL be a no-op

#### Scenario: Retrieve delegates to callback
- **WHEN** calling `retriever.retrieve("What is X?", 5)`
- **THEN** the retriever SHALL call `retrieveFn("What is X?", 5)` and return its result

#### Scenario: Init delegates to initFn if provided
- **WHEN** creating with a custom `initFn` and calling `retriever.init(corpus)`
- **THEN** the retriever SHALL call `initFn(corpus)`

#### Scenario: Cleanup delegates to cleanupFn if provided
- **WHEN** creating with a custom `cleanupFn` and calling `retriever.cleanup()`
- **THEN** the retriever SHALL call `cleanupFn()`

### Requirement: CallbackRetriever exported from eval-lib
The `CallbackRetriever` class and `CallbackRetrieverConfig` type SHALL be exported from the eval-lib's main entry point (`src/index.ts`) and from `src/experiments/index.ts`.

#### Scenario: Import from main entry
- **WHEN** importing from `"rag-evaluation-system"`
- **THEN** `CallbackRetriever` and `CallbackRetrieverConfig` SHALL be available
