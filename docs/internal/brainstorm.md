# RAG Evaluation Framework - Architecture Brainstorm (TypeScript)

## Core Insight: Evaluation Type as First-Class Concept

The evaluation type (chunk-level vs token-level) should be a **foundational choice** that shapes the entire pipeline, not an afterthought. This means:

1. Different LangSmith dataset schemas
2. Different synthetic data generation strategies
3. Different chunker interfaces (or adapters)
4. Different metric implementations
5. Strong typing that makes incompatible combinations impossible at compile time

TypeScript's structural type system, branded types, and discriminated unions make this especially powerful.

---

## Two Evaluation Paradigms

### Chunk-Level Evaluation
- **Question**: "Did we retrieve the right chunks?"
- **Ground truth**: List of chunk IDs that are relevant
- **Metric basis**: Set intersection of chunk IDs
- **Simpler**, but binary (chunk is relevant or not)

### Token-Level Evaluation (Character Spans)
- **Question**: "Did we retrieve the right *content*?"
- **Ground truth**: List of character spans (docId, start, end, text) - NO chunking at data generation
- **Metric basis**: Character overlap between ground truth spans and retrieved chunk positions
- **More granular**, captures partial relevance

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        TEXT CORPUS                               │
│                  (folder of markdown files)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   CHOOSE EVALUATION TYPE      │
              │  (chunk-level | token-level)  │
              └───────────────────────────────┘
                              │
           ┌──────────────────┴──────────────────┐
           ▼                                     ▼
┌─────────────────────┐               ┌─────────────────────┐
│  CHUNK-LEVEL PATH   │               │  TOKEN-LEVEL PATH   │
└─────────────────────┘               └─────────────────────┘
           │                                     │
           ▼                                     ▼
┌─────────────────────┐               ┌─────────────────────┐
│ SyntheticDataGen    │               │ SyntheticDataGen    │
│ (ChunkLevel)        │               │ (TokenLevel)        │
│                     │               │                     │
│ Output:             │               │ Output:             │
│ - query             │               │ - query             │
│ - relevantChunkIds  │               │ - relevantSpans     │
│   (chunk_xxxxx)     │               │   (CharacterSpan[]) │
└─────────────────────┘               └─────────────────────┘
           │                                     │
           ▼                                     ▼
┌─────────────────────┐               ┌─────────────────────┐
│ LangSmith Dataset   │               │ LangSmith Dataset   │
│ (ChunkLevelSchema)  │               │ (TokenLevelSchema)  │
│                     │               │                     │
│ Stores: chunk IDs   │               │ Stores: char spans  │
└─────────────────────┘               └─────────────────────┘
           │                                     │
           ▼                                     ▼
┌─────────────────────┐               ┌─────────────────────┐
│ Evaluation          │               │ Evaluation          │
│ (ChunkLevel)        │               │ (TokenLevel)        │
│                     │               │                     │
│ Uses:               │               │ Uses:               │
│ - Chunker           │               │ - PositionAware     │
│ - Embedder          │               │   Chunker (required)│
│ - VectorStore       │               │ - Embedder          │
│ - Reranker          │               │ - VectorStore       │
│                     │               │ - Reranker          │
│ Metrics:            │               │                     │
│ - ChunkRecall       │               │ Metrics:            │
│ - ChunkPrecision    │               │ - SpanRecall        │
│ - ChunkF1           │               │ - SpanPrecision     │
└─────────────────────┘               │ - SpanIoU           │
                                      └─────────────────────┘
```

---

## Type Definitions

### Branded Types for Type Safety

TypeScript doesn't have `NewType` like Python, but we can use **branded types** (also called opaque types) to achieve the same compile-time safety. This prevents accidentally passing a `ChunkId` where a `DocumentId` is expected.

```typescript
// =============================================================================
// BRANDED TYPE UTILITY
// =============================================================================

/**
 * Utility for creating nominal/branded types.
 * Prevents mixing up string types at compile time.
 */
type Brand<K, T> = T & { readonly __brand: K };

// =============================================================================
// PRIMITIVE TYPE ALIASES (Branded)
// =============================================================================

/** Unique identifier for a document in the corpus. e.g. "rag_overview.md" */
type DocumentId = Brand<"DocumentId", string>;

/** Unique identifier for a query. e.g. "query_f47ac10b" */
type QueryId = Brand<"QueryId", string>;

/** The actual query/question text. */
type QueryText = Brand<"QueryText", string>;

/**
 * Unique identifier for a standard chunk (without position tracking).
 * Format: "chunk_" + first 12 chars of SHA256 hash.
 * Example: "chunk_a3f2b1c8d9e0"
 */
type ChunkId = Brand<"ChunkId", string>;

/**
 * Unique identifier for a position-aware chunk.
 * Format: "pa_chunk_" + first 12 chars of SHA256 hash.
 * Example: "pa_chunk_7d9e4f2a1b3c"
 */
type PositionAwareChunkId = Brand<"PositionAwareChunkId", string>;

/** The evaluation type - foundational choice shaping the entire pipeline. */
type EvaluationType = "chunk-level" | "token-level";
```

### Core Types

```typescript
// =============================================================================
// DOCUMENT AND CORPUS
// =============================================================================

interface Document {
  readonly id: DocumentId;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
}

interface Corpus {
  readonly documents: readonly Document[];
  readonly metadata: Record<string, unknown>;
}

// =============================================================================
// CHUNK TYPES
// =============================================================================

/**
 * A chunk of text extracted from a document (without position tracking).
 * Used in chunk-level evaluation.
 */
interface Chunk {
  readonly id: ChunkId;
  readonly content: string;
  readonly docId: DocumentId;
  readonly metadata: Record<string, unknown>;
}

/**
 * A span of characters in a source document.
 * Used for token-level ground truth and metric computation.
 */
interface CharacterSpan {
  readonly docId: DocumentId;
  readonly start: number;  // inclusive, 0-indexed
  readonly end: number;    // exclusive
  readonly text: string;   // actual text content (for convenience and validation)
}

/**
 * A chunk that knows its exact position in the source document.
 * Required for token-level evaluation at EVALUATION TIME.
 */
interface PositionAwareChunk {
  readonly id: PositionAwareChunkId;
  readonly content: string;
  readonly docId: DocumentId;
  readonly start: number;  // inclusive, 0-indexed
  readonly end: number;    // exclusive
  readonly metadata: Record<string, unknown>;
}

// =============================================================================
// QUERY TYPES
// =============================================================================

interface Query {
  readonly id: QueryId;
  readonly text: QueryText;
  readonly metadata: Record<string, unknown>;
}
```

### Chunk-Level Types

```typescript
// =============================================================================
// CHUNK-LEVEL GROUND TRUTH AND RESULTS
// =============================================================================

interface ChunkLevelGroundTruth {
  readonly query: Query;
  readonly relevantChunkIds: readonly ChunkId[];
}

interface ChunkLevelDatasetExample {
  inputs: { query: QueryText };
  outputs: { relevantChunkIds: ChunkId[] };
  metadata: Record<string, unknown>;
}

interface ChunkLevelRunOutput {
  retrievedChunkIds: ChunkId[];
}
```

### Token-Level Types

```typescript
// =============================================================================
// TOKEN-LEVEL GROUND TRUTH AND RESULTS
// =============================================================================

/**
 * Ground truth is chunker-independent. The same ground truth dataset
 * can be used to evaluate ANY chunking strategy.
 */
interface TokenLevelGroundTruth {
  readonly query: Query;
  readonly relevantSpans: readonly CharacterSpan[];
}

interface TokenLevelDatasetExample {
  inputs: { query: QueryText };
  outputs: { relevantSpans: CharacterSpan[] };
  metadata: Record<string, unknown>;
}

interface TokenLevelRunOutput {
  retrievedSpans: CharacterSpan[];
}
```

---

## Interface Definitions

### Chunker Interfaces

Two separate interfaces with an adapter pattern for maximum flexibility.

```typescript
// =============================================================================
// CHUNKER INTERFACES
// =============================================================================

/**
 * Base chunker interface - returns text chunks without position tracking.
 * Use for chunk-level evaluation or when positions aren't needed.
 */
interface Chunker {
  readonly name: string;
  chunk(text: string): string[];
}

/**
 * Chunker that tracks character positions in the source document.
 * Required for token-level evaluation.
 */
interface PositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): PositionAwareChunk[];
}

/**
 * Adapter that wraps a regular Chunker to make it position-aware.
 * Finds each chunk's position by searching in the source text.
 *
 * Limitations:
 * - May fail if the chunker normalizes whitespace or modifies text
 * - Logs a warning and skips chunks that can't be located
 */
class ChunkerPositionAdapter implements PositionAwareChunker {
  readonly name: string;
  private chunker: Chunker;
  private _skippedChunks: number = 0;

  constructor(chunker: Chunker) {
    this.chunker = chunker;
    this.name = `PositionAdapter(${chunker.name})`;
  }

  get skippedChunks(): number {
    return this._skippedChunks;
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    const chunks = this.chunker.chunk(doc.content);
    const result: PositionAwareChunk[] = [];
    let currentPos = 0;

    for (const chunkText of chunks) {
      let start = doc.content.indexOf(chunkText, currentPos);

      if (start === -1) {
        // Try from beginning (handles non-sequential chunkers)
        start = doc.content.indexOf(chunkText);
      }

      if (start === -1) {
        console.warn(
          `Could not locate chunk in source document '${doc.id}'. ` +
          `Chunk preview: ${chunkText.substring(0, 50)}...`
        );
        this._skippedChunks++;
        continue;
      }

      const end = start + chunkText.length;

      result.push({
        id: generatePaChunkId(chunkText),
        content: chunkText,
        docId: doc.id,
        start,
        end,
        metadata: {},
      });
      currentPos = end;
    }

    return result;
  }
}
```

### ID Generation

```typescript
import { createHash } from "node:crypto";

function generateChunkId(content: string): ChunkId {
  const hash = createHash("sha256").update(content).digest("hex").substring(0, 12);
  return `chunk_${hash}` as ChunkId;
}

function generatePaChunkId(content: string): PositionAwareChunkId {
  const hash = createHash("sha256").update(content).digest("hex").substring(0, 12);
  return `pa_chunk_${hash}` as PositionAwareChunkId;
}
```

### CharacterSpan Utilities

```typescript
function spanOverlaps(a: CharacterSpan, b: CharacterSpan): boolean {
  if (a.docId !== b.docId) return false;
  return a.start < b.end && b.start < a.end;
}

function spanOverlapChars(a: CharacterSpan, b: CharacterSpan): number {
  if (!spanOverlaps(a, b)) return 0;
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

function spanLength(span: CharacterSpan): number {
  return span.end - span.start;
}

function positionAwareChunkToSpan(chunk: PositionAwareChunk): CharacterSpan {
  return {
    docId: chunk.docId,
    start: chunk.start,
    end: chunk.end,
    text: chunk.content,
  };
}
```

---

### Synthetic Data Generation

```typescript
// =============================================================================
// SYNTHETIC DATA GENERATORS
// =============================================================================

/**
 * Base interface for LLM clients used in synthetic data generation.
 * Compatible with OpenAI SDK pattern.
 */
interface LLMClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        response_format?: { type: string };
      }): Promise<{
        choices: Array<{ message: { content: string } }>;
      }>;
    };
  };
}

/**
 * Chunk-level: requires a chunker because chunk IDs must exist before
 * we can reference them in ground truth. LLM generates queries AND
 * identifies relevant chunks simultaneously.
 */
interface ChunkLevelSyntheticDatasetGeneratorOptions {
  llmClient: LLMClient;
  corpus: Corpus;
  chunker: Chunker;  // Required: must chunk first to get chunk IDs
}

/**
 * Token-level: NO chunker required. Ground truth is chunker-independent.
 * Generates relevant excerpts directly from documents as character spans.
 *
 * Advantages:
 * - Same ground truth works with ANY chunking strategy
 * - Can fairly compare different chunkers
 */
interface TokenLevelSyntheticDatasetGeneratorOptions {
  llmClient: LLMClient;
  corpus: Corpus;
  // Note: NO chunker required
}

interface GenerateOptions {
  queriesPerDoc?: number;       // default: 5
  uploadToLangsmith?: boolean;  // default: true
  datasetName?: string;
}
```

**Key Insight**: Token-level synthetic data generation is **chunker-independent**. We generate relevant excerpts directly from documents as character spans. This means:
- Same ground truth dataset works with ANY chunking strategy
- Can fairly compare different chunkers against same baseline
- This is a major advantage of token-level evaluation

For chunk-level, we must chunk first, which means:
- Ground truth is tied to a specific chunking strategy
- Changing chunkers requires regenerating ground truth

---

### Embedder, Vector Store, and Reranker Interfaces

```typescript
// =============================================================================
// EMBEDDER
// =============================================================================

interface Embedder {
  readonly name: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}

// =============================================================================
// VECTOR STORE
// =============================================================================

/**
 * Vector stores must preserve position metadata for token-level evaluation.
 */
interface VectorStore {
  readonly name: string;
  add(chunks: PositionAwareChunk[], embeddings: number[][]): Promise<void>;
  search(queryEmbedding: number[], k: number): Promise<PositionAwareChunk[]>;
  clear(): Promise<void>;
}

// =============================================================================
// RERANKER
// =============================================================================

interface Reranker {
  readonly name: string;
  rerank(
    query: string,
    chunks: PositionAwareChunk[],
    topK?: number,
  ): Promise<PositionAwareChunk[]>;
}
```

---

### Evaluation Classes

```typescript
// =============================================================================
// EVALUATION RESULT
// =============================================================================

interface EvaluationResult {
  metrics: Record<string, number>;
  experimentUrl?: string;
  rawResults?: unknown;
}

// =============================================================================
// METRICS
// =============================================================================

interface ChunkLevelMetric {
  readonly name: string;
  calculate(retrievedChunkIds: ChunkId[], groundTruthChunkIds: ChunkId[]): number;
}

interface TokenLevelMetric {
  readonly name: string;
  calculate(retrievedSpans: CharacterSpan[], groundTruthSpans: CharacterSpan[]): number;
}

// =============================================================================
// EVALUATION ORCHESTRATORS
// =============================================================================

interface ChunkLevelEvaluationConfig {
  corpus: Corpus;
  langsmithDatasetName: string;
}

interface ChunkLevelRunOptions {
  chunker: Chunker;
  embedder: Embedder;
  k?: number;                          // default: 5
  vectorStore?: VectorStore;           // defaults to ChromaVectorStore
  reranker?: Reranker;                 // defaults to undefined (none)
  metrics?: ChunkLevelMetric[];        // defaults to [ChunkRecall, ChunkPrecision, ChunkF1]
}

interface TokenLevelEvaluationConfig {
  corpus: Corpus;
  langsmithDatasetName: string;
}

interface TokenLevelRunOptions {
  chunker: Chunker | PositionAwareChunker; // wrapped with adapter if needed
  embedder: Embedder;
  k?: number;                              // default: 5
  vectorStore?: VectorStore;               // defaults to ChromaVectorStore
  reranker?: Reranker;
  metrics?: TokenLevelMetric[];            // defaults to [SpanRecall, SpanPrecision, SpanIoU]
}
```

---

### Metrics

```typescript
// =============================================================================
// CHUNK-LEVEL METRICS
// =============================================================================

class ChunkRecall implements ChunkLevelMetric {
  readonly name = "chunk_recall";

  calculate(retrievedChunkIds: ChunkId[], groundTruthChunkIds: ChunkId[]): number {
    if (groundTruthChunkIds.length === 0) return 1.0; // Nothing to recall => trivially satisfied
    const retrieved = new Set(retrievedChunkIds);
    const gt = new Set(groundTruthChunkIds);
    const intersection = [...gt].filter((id) => retrieved.has(id));
    return intersection.length / gt.size;
  }
}

class ChunkPrecision implements ChunkLevelMetric {
  readonly name = "chunk_precision";

  calculate(retrievedChunkIds: ChunkId[], groundTruthChunkIds: ChunkId[]): number {
    if (retrievedChunkIds.length === 0) return 0.0;
    const retrieved = new Set(retrievedChunkIds);
    const gt = new Set(groundTruthChunkIds);
    const intersection = [...retrieved].filter((id) => gt.has(id));
    return intersection.length / retrieved.size;
  }
}

class ChunkF1 implements ChunkLevelMetric {
  readonly name = "chunk_f1";

  calculate(retrievedChunkIds: ChunkId[], groundTruthChunkIds: ChunkId[]): number {
    const recall = new ChunkRecall().calculate(retrievedChunkIds, groundTruthChunkIds);
    const precision = new ChunkPrecision().calculate(retrievedChunkIds, groundTruthChunkIds);
    if (recall + precision === 0) return 0.0;
    return (2 * precision * recall) / (precision + recall);
  }
}

// =============================================================================
// TOKEN-LEVEL METRICS
// =============================================================================

// Span merging: merge overlapping spans within the same document
// Uses interval merging algorithm: group by doc, sort by start, merge overlapping
function mergeOverlappingSpans(spans: CharacterSpan[]): CharacterSpan[] {
  if (spans.length === 0) return [];

  const byDoc = new Map<string, CharacterSpan[]>();
  for (const span of spans) {
    const existing = byDoc.get(span.docId) ?? [];
    existing.push(span);
    byDoc.set(span.docId, existing);
  }

  const merged: CharacterSpan[] = [];

  for (const [_docId, docSpans] of byDoc) {
    const sorted = [...docSpans].sort((a, b) => a.start - b.start);
    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= current.end) {
        current = {
          docId: current.docId,
          start: current.start,
          end: Math.max(current.end, sorted[i].end),
          text: "", // placeholder - reconstruct from source if needed
        };
      } else {
        merged.push(current);
        current = sorted[i];
      }
    }
    merged.push(current);
  }

  return merged;
}

function calculateOverlap(spansA: CharacterSpan[], spansB: CharacterSpan[]): number {
  const mergedA = mergeOverlappingSpans(spansA);
  const mergedB = mergeOverlappingSpans(spansB);

  let total = 0;
  for (const a of mergedA) {
    for (const b of mergedB) {
      if (a.docId === b.docId) {
        total += spanOverlapChars(a, b);
      }
    }
  }
  return total;
}

class SpanRecall implements TokenLevelMetric {
  readonly name = "span_recall";

  calculate(retrievedSpans: CharacterSpan[], groundTruthSpans: CharacterSpan[]): number {
    if (groundTruthSpans.length === 0) return 1.0; // Nothing to recall => trivially satisfied
    const mergedGt = mergeOverlappingSpans(groundTruthSpans);
    const totalGtChars = mergedGt.reduce((sum, s) => sum + spanLength(s), 0);
    if (totalGtChars === 0) return 1.0;
    const overlap = calculateOverlap(retrievedSpans, groundTruthSpans);
    return Math.min(overlap / totalGtChars, 1.0);
  }
}

class SpanPrecision implements TokenLevelMetric {
  readonly name = "span_precision";

  calculate(retrievedSpans: CharacterSpan[], groundTruthSpans: CharacterSpan[]): number {
    if (retrievedSpans.length === 0) return 0.0;
    const mergedRet = mergeOverlappingSpans(retrievedSpans);
    const totalRetChars = mergedRet.reduce((sum, s) => sum + spanLength(s), 0);
    const overlap = calculateOverlap(retrievedSpans, groundTruthSpans);
    return Math.min(overlap / totalRetChars, 1.0);
  }
}

class SpanIoU implements TokenLevelMetric {
  readonly name = "span_iou";

  calculate(retrievedSpans: CharacterSpan[], groundTruthSpans: CharacterSpan[]): number {
    if (retrievedSpans.length === 0 && groundTruthSpans.length === 0) return 1.0;
    if (retrievedSpans.length === 0 || groundTruthSpans.length === 0) return 0.0;

    const mergedRet = mergeOverlappingSpans(retrievedSpans);
    const mergedGt = mergeOverlappingSpans(groundTruthSpans);
    const intersection = calculateOverlap(retrievedSpans, groundTruthSpans);
    const totalRet = mergedRet.reduce((sum, s) => sum + spanLength(s), 0);
    const totalGt = mergedGt.reduce((sum, s) => sum + spanLength(s), 0);
    const union = totalRet + totalGt - intersection;

    return union > 0 ? intersection / union : 0.0;
  }
}
```

---

## LangSmith Dataset Schemas

### Chunk-Level Dataset

```json
{
  "name": "rag-eval-chunk-level-v1",
  "description": "Ground truth for chunk-level RAG evaluation",
  "example_schema": {
    "inputs": {
      "query": "string"
    },
    "outputs": {
      "relevantChunkIds": ["string (format: chunk_xxxxxxxxxx)"]
    },
    "metadata": {
      "sourceDocs": ["string"],
      "generationModel": "string",
      "generationType": "string (synthetic | manual)",
      "persona": "string (optional)",
      "difficulty": "string (optional)",
      "queryType": "string (optional)"
    }
  }
}
```

### Token-Level Dataset

```json
{
  "name": "rag-eval-token-level-v1",
  "description": "Ground truth for token-level RAG evaluation (character spans)",
  "example_schema": {
    "inputs": {
      "query": "string"
    },
    "outputs": {
      "relevantSpans": [
        {
          "docId": "string",
          "start": "integer",
          "end": "integer",
          "text": "string"
        }
      ]
    },
    "metadata": {
      "sourceDocs": ["string"],
      "generationModel": "string",
      "generationType": "string (synthetic | manual)"
    }
  }
}
```

**Note**: Token-level ground truth stores actual character spans with text, NOT chunk IDs.

---

## User-Facing API

```typescript
import {
  Corpus,
  ChunkLevelEvaluation,
  TokenLevelEvaluation,
  RecursiveCharacterChunker,
  OpenAIEmbedder,
  ChromaVectorStore,
  CohereReranker,
} from "rag-evaluation-system";

const corpus = await Corpus.fromFolder("./knowledge_base");

// =============================================================================
// CHUNK-LEVEL EVALUATION
// =============================================================================

const chunkEval = new ChunkLevelEvaluation({
  corpus,
  langsmithDatasetName: "my-chunk-dataset",
});

const result = await chunkEval.run({
  chunker: new RecursiveCharacterChunker({ chunkSize: 200 }),
  embedder: new OpenAIEmbedder(),
  k: 5,
  // vectorStore: new ChromaVectorStore(),  // Optional
  // reranker: new CohereReranker(),        // Optional
});

// =============================================================================
// TOKEN-LEVEL EVALUATION
// =============================================================================

const tokenEval = new TokenLevelEvaluation({
  corpus,
  langsmithDatasetName: "my-token-dataset",
});

const tokenResult = await tokenEval.run({
  chunker: new RecursiveCharacterChunker({ chunkSize: 200 }), // Wrapped as PositionAware
  embedder: new OpenAIEmbedder(),
  k: 5,
});
```

---

## Full Workflow Example

### Token-Level (Recommended for Chunker Comparison)

```typescript
import {
  Corpus,
  TokenLevelSyntheticDatasetGenerator,
  TokenLevelEvaluation,
  RecursiveCharacterChunker,
  FixedTokenChunker,
  SemanticChunker,
  OpenAIEmbedder,
} from "rag-evaluation-system";
import OpenAI from "openai";

// 1. Load corpus
const corpus = await Corpus.fromFolder("./knowledge_base");

// 2. Generate synthetic data (one-time)
// Note: NO chunker required - ground truth is character spans!
const generator = new TokenLevelSyntheticDatasetGenerator({
  llmClient: new OpenAI(),
  corpus,
});

await generator.generate({
  queriesPerDoc: 10,
  uploadToLangsmith: true,
  datasetName: "my-rag-eval-token-level",
});

// 3. Run evaluation with different chunkers
const evaluation = new TokenLevelEvaluation({
  corpus,
  langsmithDatasetName: "my-rag-eval-token-level",
});

const chunkersToTest = [
  new RecursiveCharacterChunker({ chunkSize: 200, chunkOverlap: 0 }),
  new RecursiveCharacterChunker({ chunkSize: 200, chunkOverlap: 50 }),
  new RecursiveCharacterChunker({ chunkSize: 500, chunkOverlap: 0 }),
  new FixedTokenChunker({ tokensPerChunk: 100 }),
  new SemanticChunker({ embedder: new OpenAIEmbedder() }),
];

for (const chunker of chunkersToTest) {
  const result = await evaluation.run({
    chunker,
    embedder: new OpenAIEmbedder(),
    k: 5,
  });
  console.log(`${chunker.name}: Recall=${result.metrics.span_recall.toFixed(3)}`);
}
```

### Chunk-Level (Simpler, but Chunker-Dependent Ground Truth)

```typescript
import {
  Corpus,
  ChunkLevelSyntheticDatasetGenerator,
  ChunkLevelEvaluation,
  RecursiveCharacterChunker,
  OpenAIEmbedder,
} from "rag-evaluation-system";
import OpenAI from "openai";

// 1. Load corpus
const corpus = await Corpus.fromFolder("./knowledge_base");

// 2. Choose chunker (fixed for this evaluation)
const chunker = new RecursiveCharacterChunker({ chunkSize: 200 });

// 3. Generate synthetic data with this chunker
const generator = new ChunkLevelSyntheticDatasetGenerator({
  llmClient: new OpenAI(),
  corpus,
  chunker, // Required! Ground truth is tied to this chunker.
});

await generator.generate({
  queriesPerDoc: 10,
  uploadToLangsmith: true,
  datasetName: "my-rag-eval-chunk-level",
});

// 4. Run evaluation (must use same chunker!)
const evaluation = new ChunkLevelEvaluation({
  corpus,
  langsmithDatasetName: "my-rag-eval-chunk-level",
});

const result = await evaluation.run({
  chunker,
  embedder: new OpenAIEmbedder(),
  k: 5,
});
```

---

## Resolved Design Decisions

### 1. Chunk ID Format
- **Standard chunks**: `chunk_` + first 12 chars of SHA256 hash (e.g., `chunk_a3f2b1c8d9e0`)
- **Position-aware chunks**: `pa_chunk_` + first 12 chars of SHA256 hash (e.g., `pa_chunk_7d9e4f2a1b3c`)
- Prefixes make type immediately clear; content hash ensures determinism and dedup

### 2. Handling Overlapping Spans in Token-Level Metrics
- Merge overlapping retrieved spans before comparison. Count each character at most once.
- Prevents sliding window chunkers from artificially inflating metrics.

### 3. Cross-Document Ground Truth
- Support queries with relevant spans from multiple documents.

### 4. VectorStore Position Tracking
- Store positions in vector store metadata, return with results.
- Most vector stores (Chroma, Qdrant, Pinecone) support arbitrary metadata.

### 5. Adapter Failure Cases
- Warn and skip problematic chunks. Most chunkers preserve text exactly.

### 6. Chunker Interface
- Two separate interfaces (`Chunker` and `PositionAwareChunker`) with adapter pattern.

### 7. TypeScript-Specific Decisions
- Use **branded types** for compile-time safety of IDs (DocumentId, ChunkId, etc.)
- Use **interfaces** instead of abstract classes where possible (more idiomatic TS)
- Use **Zod** for runtime validation (TypeScript equivalent of Pydantic)
- All async operations return **Promises** (embedder, vector store, reranker, evaluation)
- Use **readonly** properties and `ReadonlyArray` for immutability

---

## Summary: Chunk-Level vs Token-Level

| Aspect | Chunk-Level | Token-Level |
|--------|-------------|-------------|
| Ground truth format | Chunk IDs (`chunk_xxx`) | Character spans (`{docId, start, end, text}`) |
| Chunker for data gen | Required | NOT required |
| Compare chunkers fairly | No (tied to GT chunker) | Yes (chunker-independent GT) |
| Implementation complexity | Lower | Higher |
| Metric granularity | Binary (chunk relevant or not) | Continuous (% overlap) |
| Chunker at eval time | Regular Chunker | PositionAwareChunker (required) |
| Best for | Quick iteration, simple cases | Research, chunker comparison |

**Recommendation**:
- Use **Token-Level** as the primary approach for comparing chunking strategies
- Use **Chunk-Level** when you need simpler setup and don't need fine-grained metrics

---

## Senior Engineer Review Notes

> Reviewed 2026-01-30. These notes cover type system design, algorithmic correctness, API ergonomics, and missing abstractions in the brainstorm document.

### Inline Fixes Applied

1. **`Brand` type should use `readonly __brand`.** Changed `{ __brand: K }` to `{ readonly __brand: K }`. Without `readonly`, calling code could theoretically assign to `__brand` and defeat the branding. Minor but principled.

2. **`ChunkRecall` and `SpanRecall` returned `0.0` for empty ground truth.** If there is nothing to recall, recall is trivially 1.0 (vacuous truth). Changed to `return 1.0`. This matches the convention used in standard IR literature. The `ChunkF1` class composes recall and precision, so it automatically benefits from this fix.

3. **`SpanRecall` did not guard against `totalGtChars === 0`.** After merging, all spans could collapse to zero-length spans (e.g., `start === end`). Added a `totalGtChars === 0` guard returning `1.0`.

4. **`mergeOverlappingSpans` unused `docId` loop variable.** The `for (const [docId, docSpans] of byDoc)` destructured `docId` but never used it (the merged spans already carry their own `docId`). Renamed to `_docId` to signal intent. In implementation, use `_` prefix or omit.

### Type System Design

5. **`Brand` utility should use `unique symbol` for stronger nominal typing.** The current `Brand<K, T> = T & { readonly __brand: K }` approach uses a string literal for `K`. Two separately declared brands with the same string key would be structurally compatible. The stronger pattern:
    ```typescript
    declare const __brand: unique symbol;
    type Brand<K extends string, T> = T & { readonly [__brand]: K };
    ```
    This prevents accidental structural compatibility while keeping the ergonomics.

6. **`ChunkId` and `PositionAwareChunkId` are unrelated branded types, but `ChunkId` values might need to map to `PositionAwareChunkId` during evaluation.** The brainstorm does not define a mapping function. The implementation plan's `String(c.id).replace("pa_chunk_", "chunk_")` hack (noted as fragile in that review) originates from this gap. Add an explicit `chunkIdFromPaChunkId(id: PositionAwareChunkId): ChunkId` utility, or better, store the logical `ChunkId` as metadata on `PositionAwareChunk`.

7. **`metadata: Record<string, unknown>` on every type is convenient but untyped.** Consider making it generic: `interface Document<M extends Record<string, unknown> = Record<string, unknown>>` so consumers can narrow metadata types when needed. This avoids littering the codebase with type assertions.

8. **`EvaluationType` is defined but never structurally connected to the type system.** It is a plain union `"chunk-level" | "token-level"` but nothing in the type definitions enforces that chunk-level code cannot use token-level types or vice versa. Consider a discriminated union approach:
    ```typescript
    type EvaluationConfig =
      | { readonly type: "chunk-level"; readonly config: ChunkLevelEvaluationConfig }
      | { readonly type: "token-level"; readonly config: TokenLevelEvaluationConfig };
    ```
    This would make it impossible to mix evaluation types at the orchestration layer.

9. **`ChunkLevelDatasetExample` and `TokenLevelDatasetExample` lack `readonly` modifiers.** These types have mutable `inputs`, `outputs`, and `metadata` fields, inconsistent with every other type in the document which uses `readonly`. Make them consistent.

10. **`LLMClient` interface is over-coupled to the OpenAI SDK shape.** It hard-codes `chat.completions.create` nesting. A simpler abstraction would be easier to implement for non-OpenAI providers:
    ```typescript
    interface LLMClient {
      readonly name: string;
      complete(params: {
        model: string;
        messages: ReadonlyArray<{ role: string; content: string }>;
        responseFormat?: "json" | "text";
      }): Promise<string>;
    }
    ```
    Then provide an `openAIClientAdapter(client: OpenAI): LLMClient` function for OpenAI SDK users. This decouples the framework from any specific SDK.

### Algorithm Correctness

11. **`mergeOverlappingSpans` produces spans with `text: ""`.** This is flagged in the implementation plan review too. For metric computation, `text` is never read -- only `start`, `end`, and `docId` matter. Introduce a `SpanRange` type for internal metric calculations:
    ```typescript
    interface SpanRange {
      readonly docId: DocumentId;
      readonly start: number;
      readonly end: number;
    }
    ```
    Keep `CharacterSpan` (with `text`) at API boundaries. `mergeOverlappingSpans` should operate on and return `SpanRange[]`.

12. **`calculateOverlap` is O(n*m) where n and m are the merged span counts.** For typical RAG workloads (tens of spans), this is fine. But if spans are all from the same document, a two-pointer sweep after sorting would be O(n log n + m log m), which is better for large span sets. Document the complexity or leave a note that optimization is possible.

13. **`calculateOverlap` double-merges when called from `SpanRecall`/`SpanPrecision`.** `SpanRecall.calculate` calls `mergeOverlappingSpans(groundTruthSpans)` to compute `totalGtChars`, then calls `calculateOverlap(retrievedSpans, groundTruthSpans)` which internally merges both inputs again. This is wasteful. Refactor so metrics receive pre-merged spans, or have `calculateOverlap` accept already-merged inputs with a flag.

14. **`spanOverlapChars` and `spanOverlaps` do not validate that `start < end`.** A zero-length or negative-length span would produce incorrect results. Add a `CharacterSpan` factory or validation function that enforces `start >= 0 && start <= end`. Use Zod at runtime boundaries.

15. **`ChunkF1.calculate` instantiates new `ChunkRecall()` and `ChunkPrecision()` on every call.** This is wasteful allocation. Either inject the metric instances or make `ChunkRecall` and `ChunkPrecision` stateless module-level singletons. Better yet, make them plain functions rather than classes -- they have no state.

### Adapter Pattern

16. **`ChunkerPositionAdapter` fails silently on duplicate text.** If the same substring appears multiple times in a document and the chunker produces chunks in non-sequential order, `indexOf(chunkText, currentPos)` will find the wrong occurrence, and the fallback `indexOf(chunkText)` (from position 0) will always match the first occurrence. This corrupts position data without any warning. Mitigation: after the fallback match, verify that the matched region does not overlap with any already-assigned span. If it does, skip and warn.

17. **`ChunkerPositionAdapter` has mutable state (`_skippedChunks`) but no reset mechanism.** If the adapter is reused across multiple documents (which `chunkWithPositions` implies -- it takes a single `Document`), the counter accumulates. Add a `resetStats()` method or make the counter per-call by returning it alongside the result:
    ```typescript
    chunkWithPositions(doc: Document): { chunks: PositionAwareChunk[]; skipped: number };
    ```

18. **`Chunker.chunk(text: string): string[]` loses document identity.** The `PositionAwareChunker.chunkWithPositions(doc: Document)` takes a `Document`, but `Chunker.chunk` takes raw `string`. The adapter bridges this, but any `Chunker` implementation that needs document metadata (e.g., to set chunk metadata) cannot access it. Consider `chunk(doc: Document): Chunk[]` instead, or at minimum `chunk(text: string, docId: DocumentId): Chunk[]`.

### Synthetic Data Generation Design

19. **No validation that LLM-generated spans actually exist in the source document.** The token-level generator presumably asks an LLM to identify relevant excerpts and return character positions. LLMs hallucinate positions. The generator must:
    - Validate that `document.content.slice(span.start, span.end) === span.text`
    - If the LLM returns text but no positions, use `indexOf` to find the text
    - If the LLM returns positions but no text, extract and store the text
    - Reject spans that fail validation

20. **No deduplication of generated queries.** If `queriesPerDoc` is high, the LLM may generate semantically duplicate queries. Consider adding a dedup step (exact string match at minimum, embedding-based similarity for robustness).

21. **No control over query difficulty or type distribution.** The `GenerateOptions` interface has `queriesPerDoc` but no way to specify distribution of query types (factoid, multi-hop, comparison, etc.) or difficulty levels. The LangSmith schema includes `difficulty` and `queryType` in metadata, suggesting this was intended but not exposed. Add:
    ```typescript
    interface GenerateOptions {
      queriesPerDoc?: number;
      queryTypes?: ReadonlyArray<"factoid" | "multi-hop" | "comparison" | "boolean">;
      difficultyDistribution?: { easy: number; medium: number; hard: number };
      // ...existing fields
    }
    ```

22. **Token-level data generation needs a strategy for selecting relevant passages.** The brainstorm says "generates relevant excerpts directly from documents as character spans" but does not describe how. Two approaches:
    - **LLM-driven**: Ask the LLM to read the document and identify relevant passages for a given query. Risk: LLM may return approximate text that does not exactly match.
    - **Hybrid**: LLM generates the query and quotes the relevant text, then a post-processing step locates the exact spans via string matching. This is more reliable.
    Document the chosen approach and its tradeoffs.

### LangSmith Schema Design

23. **No versioning field in the dataset examples.** The dataset names include `v1` but individual examples do not carry a schema version. If the schema evolves, there is no way to distinguish old examples from new ones within the same dataset. Add `schemaVersion: number` to metadata.

24. **No `queryId` in the dataset example schema.** The `Query` type has an `id` field, but `ChunkLevelDatasetExample` and `TokenLevelDatasetExample` only store `query: QueryText` in inputs. This loses the query identity. If a query appears in multiple datasets or needs cross-referencing, the ID is needed. Store it in metadata at minimum.

25. **Token-level schema stores `text` redundantly.** The `text` field in each span is derivable from `docId + start + end` given the corpus. Storing it is useful for validation and debugging but increases storage. This is the right tradeoff -- just document that `text` is authoritative and `start/end` must match.

26. **No schema for evaluation run results in LangSmith.** The document defines `EvaluationResult` but does not specify how results are stored as LangSmith experiment feedback. Define the feedback key names and value formats to ensure consistency across runs.

### API Design and Ergonomics

27. **`TokenLevelRunOptions.chunker` accepts `Chunker | PositionAwareChunker` but the adapter wrapping is implicit.** This is convenient but hides a potential failure mode (the adapter may skip chunks). Make the wrapping explicit in docs, or better, return adapter diagnostics in `EvaluationResult`:
    ```typescript
    interface EvaluationResult {
      metrics: Record<string, number>;
      diagnostics?: {
        skippedChunks?: number;
        adapterUsed?: boolean;
      };
    }
    ```

28. **No way to provide a custom `PositionAwareChunker` for token-level evaluation.** `TokenLevelRunOptions.chunker` is typed as `Chunker | PositionAwareChunker`, which works via structural typing. But the interface section only mentions the adapter path. Clarify that users can implement `PositionAwareChunker` directly for best results.

29. **`VectorStore.search` returns `PositionAwareChunk[]` without scores.** Rerankers and downstream logic may want retrieval scores. Consider:
    ```typescript
    interface ScoredChunk<T> {
      readonly chunk: T;
      readonly score: number;
    }
    search(queryEmbedding: number[], k: number): Promise<ScoredChunk<PositionAwareChunk>[]>;
    ```

30. **`Embedder.embed` and `embedQuery` are separate methods with no shared contract.** There is no guarantee that `embed(["hello"])[0]` equals `embedQuery("hello")`. Document that implementations must ensure consistency, or unify into a single method.

### Comparison Table Accuracy

31. **The comparison table is accurate but incomplete.** Missing rows:
    - **Ground truth regeneration cost**: Chunk-level = must regenerate when chunker changes; Token-level = one-time cost
    - **Metric value range**: Chunk-level = {0, 1/n, 2/n, ...} (discrete); Token-level = [0.0, 1.0] (continuous)
    - **Position tracking overhead**: Chunk-level = none; Token-level = must track char offsets
    - **Failure mode of adapter**: Chunk-level = N/A; Token-level = chunks not found in source text are silently dropped

### TypeScript-Specific Improvements

32. **Use `as const satisfies` for metric name literals.** Instead of `readonly name = "chunk_recall"`, use:
    ```typescript
    readonly name = "chunk_recall" as const;
    ```
    This narrows the type from `string` to the literal `"chunk_recall"`, enabling type-safe metric name lookups.

33. **Consider a `MetricName` union type.** Derive metric names from the implementations:
    ```typescript
    type ChunkMetricName = "chunk_recall" | "chunk_precision" | "chunk_f1";
    type SpanMetricName = "span_recall" | "span_precision" | "span_iou";
    type MetricName = ChunkMetricName | SpanMetricName;
    ```
    Then type `EvaluationResult.metrics` as `Partial<Record<MetricName, number>>` instead of `Record<string, number>`.

34. **Metrics should be plain functions, not classes.** `ChunkRecall`, `ChunkPrecision`, etc. carry no state. The class pattern adds ceremony (instantiation, `implements`) with no benefit. Use a function + name tuple:
    ```typescript
    interface NamedMetric<TArgs extends unknown[]> {
      readonly name: string;
      readonly calculate: (...args: TArgs) => number;
    }

    const chunkRecall: NamedMetric<[ChunkId[], ChunkId[]]> = {
      name: "chunk_recall",
      calculate: (retrieved, groundTruth) => { /* ... */ },
    };
    ```
    This is more idiomatic TypeScript and eliminates the `new ChunkRecall()` allocation inside `ChunkF1`.

35. **Use `ReadonlyArray` in function signatures that do not mutate.** `calculate(retrievedChunkIds: ChunkId[], ...)` should be `calculate(retrievedChunkIds: readonly ChunkId[], ...)`. The brainstorm uses `readonly` on interface properties but not on function parameter arrays.

36. **`Embedder.embed` return type `number[][]` should be `ReadonlyArray<ReadonlyArray<number>>`.** Embeddings should not be mutated after creation. Same for `embedQuery` returning `number[]` -- prefer `readonly number[]`.

37. **Consider generic `VectorStore<TChunk>` for chunk-level vs token-level.** This avoids the architectural issue (noted in item 7 of the implementation plan review) where chunk-level evaluation must fabricate `PositionAwareChunk` values:
    ```typescript
    interface VectorStore<T extends { readonly id: string; readonly content: string }> {
      add(items: readonly T[], embeddings: ReadonlyArray<readonly number[]>): Promise<void>;
      search(queryEmbedding: readonly number[], k: number): Promise<readonly T[]>;
      clear(): Promise<void>;
    }
    ```

38. **Use `using` / `Symbol.dispose` for vector store lifecycle.** Node 20+ supports explicit resource management. The vector store `clear()` method is a cleanup operation that should be called in a `finally` block. With `using`:
    ```typescript
    interface Disposable {
      [Symbol.dispose](): void;
    }
    interface AsyncDisposable {
      [Symbol.asyncDispose](): Promise<void>;
    }
    ```
    Have `VectorStore` extend `AsyncDisposable` so consumers can write `await using store = new ChromaVectorStore()`.
