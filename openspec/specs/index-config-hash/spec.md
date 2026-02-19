## ADDED Requirements

### Requirement: Index config hash computation
The system SHALL provide a `computeIndexConfigHash` function that accepts the INDEX stage config (chunker type, chunkSize, chunkOverlap, embedding model name, enrichment strategy) and returns a deterministic SHA-256 hash string. The same config SHALL always produce the same hash. Different configs SHALL produce different hashes.

#### Scenario: Same config produces same hash
- **WHEN** computing the hash for `{ strategy: "plain", chunkSize: 1000, chunkOverlap: 200, embeddingModel: "text-embedding-3-small" }` twice
- **THEN** both calls SHALL return the identical hash string

#### Scenario: Different chunk size produces different hash
- **WHEN** computing hashes for configs that differ only in chunkSize (1000 vs 500)
- **THEN** the two hashes SHALL be different

#### Scenario: Hash excludes non-INDEX config
- **WHEN** computing hashes for two configs that have the same INDEX config but different SEARCH or REFINEMENT strategies
- **THEN** both hashes SHALL be identical (only INDEX config matters)

### Requirement: PipelineRetriever exposes indexConfigHash
The PipelineRetriever SHALL expose an `indexConfigHash` readonly property computed from its INDEX stage config. This hash SHALL be available after construction (before `init()` is called).

#### Scenario: Access indexConfigHash before init
- **WHEN** creating a PipelineRetriever and reading `retriever.indexConfigHash`
- **THEN** it SHALL return a non-empty string hash computed from the INDEX config
