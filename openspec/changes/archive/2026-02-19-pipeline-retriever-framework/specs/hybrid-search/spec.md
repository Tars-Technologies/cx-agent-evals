## ADDED Requirements

### Requirement: Weighted score fusion
The system SHALL provide a weighted score fusion function that combines results from two ranked lists (dense and sparse) by computing `weight_a * score_a + weight_b * score_b` for each result. Results appearing in only one list SHALL receive 0 for the missing score. The function SHALL accept configurable weights (default 0.7 dense / 0.3 sparse).

#### Scenario: Weighted fusion combines overlapping results
- **WHEN** fusing dense results [{chunk A, score 0.95}, {chunk B, score 0.82}] with sparse results [{chunk B, score 0.88}, {chunk C, score 0.76}] using weights 0.7/0.3
- **THEN** the fused result SHALL include chunk A (0.7*0.95 + 0.3*0 = 0.665), chunk B (0.7*0.82 + 0.3*0.88 = 0.838), chunk C (0.7*0 + 0.3*0.76 = 0.228), ordered by fused score descending

#### Scenario: Weighted fusion with custom weights
- **WHEN** fusing with weights 0.5 dense / 0.5 sparse
- **THEN** the fusion SHALL weight both sources equally

### Requirement: Reciprocal rank fusion (RRF)
The system SHALL provide a reciprocal rank fusion function that combines results from two ranked lists using the formula `sum(1 / (k + rank))` for each result across all lists, where `k` is a configurable constant (default 60). Results not appearing in a list SHALL not contribute a score from that list.

#### Scenario: RRF combines by rank position
- **WHEN** fusing dense results [A at rank 1, B at rank 2] with sparse results [B at rank 1, C at rank 2] using k=60
- **THEN** chunk B SHALL rank highest (appears in both lists), followed by A and C

### Requirement: Candidate multiplier
The system SHALL support a `candidateMultiplier` parameter (default 4) on hybrid search. When the final desired result count is `k`, each individual search (dense, sparse) SHALL retrieve `k * candidateMultiplier` candidates before fusion.

#### Scenario: Candidate multiplier increases raw candidates
- **WHEN** hybrid search is configured with k=6 and candidateMultiplier=4
- **THEN** dense search SHALL retrieve up to 24 candidates AND sparse search SHALL retrieve up to 24 candidates before fusion

### Requirement: SEARCH stage — hybrid strategy
The system SHALL implement a "hybrid" SEARCH strategy in the PipelineRetriever that runs both dense vector search and BM25 search in parallel, then fuses results using the configured fusion method. The hybrid config SHALL include: `denseWeight` (number), `sparseWeight` (number), `fusionMethod` ("weighted" | "rrf"), `candidateMultiplier` (number), and `rrfK` (number, for RRF only).

#### Scenario: Hybrid search combines dense and sparse
- **WHEN** a PipelineRetriever is configured with search strategy "hybrid"
- **THEN** `init()` SHALL build both a vector index and a BM25 index, and `retrieve()` SHALL run both searches and fuse results

#### Scenario: Hybrid search with weighted fusion defaults
- **WHEN** hybrid search is configured without explicit weights
- **THEN** it SHALL use 0.7 dense / 0.3 sparse weighted fusion with candidateMultiplier=4
