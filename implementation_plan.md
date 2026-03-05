# RAG Evaluation System - Implementation Plan (TypeScript)

This document provides a comprehensive, step-by-step implementation plan for the RAG Evaluation System in TypeScript. It uses modern TypeScript tooling: **pnpm** (package management), **Zod** (runtime validation), **Vitest** (testing), **ESLint + Prettier** (linting/formatting), and **tsup** (bundling).

---

## Table of Contents

1. [Project Setup](#1-project-setup)
2. [Core Types Module](#2-core-types-module)
3. [Chunker Interfaces](#3-chunker-interfaces)
4. [Embedder & Vector Store Interfaces](#4-embedder--vector-store-interfaces)
5. [Reranker Interface](#5-reranker-interface)
6. [Synthetic Data Generation](#6-synthetic-data-generation)
7. [Metrics Implementation](#7-metrics-implementation)
8. [Evaluation Classes](#8-evaluation-classes)
9. [LangSmith Integration](#9-langsmith-integration)
10. [Built-in Implementations](#10-built-in-implementations)
11. [Testing Strategy](#11-testing-strategy)
12. [Package Publishing](#12-package-publishing)

---

## 1. Project Setup

### 1.1 Initialize Project

```bash
mkdir rag-evaluation-system && cd rag-evaluation-system
pnpm init
```

### 1.2 Project Structure

```
rag-evaluation-system/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── eslint.config.mjs
├── .prettierrc
├── .gitignore
├── README.md
├── CLAUDE.md
├── LICENSE
│
├── src/
│   ├── index.ts                       # Package entry point & exports
│   │
│   ├── types/
│   │   ├── index.ts                   # Re-exports
│   │   ├── brand.ts                   # Brand<K,T> utility type
│   │   ├── primitives.ts             # Branded type aliases (DocumentId, ChunkId, etc.)
│   │   ├── documents.ts              # Document, Corpus
│   │   ├── chunks.ts                 # Chunk, PositionAwareChunk, CharacterSpan
│   │   ├── queries.ts                # Query, QueryText
│   │   ├── ground-truth.ts           # ChunkLevelGroundTruth, TokenLevelGroundTruth
│   │   ├── results.ts                # EvaluationResult, RunOutput types
│   │   └── schemas.ts                # Zod schemas for runtime validation
│   │
│   ├── chunkers/
│   │   ├── index.ts
│   │   ├── chunker.interface.ts       # Chunker, PositionAwareChunker interfaces
│   │   ├── adapter.ts                 # ChunkerPositionAdapter
│   │   ├── recursive-character.ts     # RecursiveCharacterChunker
│   │   ├── fixed-token.ts            # FixedTokenChunker
│   │   └── semantic.ts               # SemanticChunker
│   │
│   ├── embedders/
│   │   ├── index.ts
│   │   ├── embedder.interface.ts      # Embedder interface
│   │   ├── openai.ts                  # OpenAIEmbedder
│   │   └── transformers.ts            # TransformersEmbedder (using @xenova/transformers)
│   │
│   ├── vector-stores/
│   │   ├── index.ts
│   │   ├── vector-store.interface.ts  # VectorStore interface
│   │   └── chroma.ts                  # ChromaVectorStore
│   │
│   ├── rerankers/
│   │   ├── index.ts
│   │   ├── reranker.interface.ts      # Reranker interface
│   │   └── cohere.ts                  # CohereReranker
│   │
│   ├── synthetic-datagen/
│   │   ├── index.ts
│   │   ├── base.ts                    # Base generator class
│   │   ├── chunk-level/
│   │   │   ├── index.ts
│   │   │   └── generator.ts           # ChunkLevelSyntheticDatasetGenerator
│   │   └── token-level/
│   │       ├── index.ts
│   │       └── generator.ts           # TokenLevelSyntheticDatasetGenerator
│   │
│   ├── evaluation/
│   │   ├── index.ts
│   │   ├── chunk-level.ts             # ChunkLevelEvaluation
│   │   ├── token-level.ts             # TokenLevelEvaluation
│   │   └── metrics/
│   │       ├── index.ts
│   │       ├── base.ts                # ChunkLevelMetric, TokenLevelMetric interfaces
│   │       ├── chunk-level/
│   │       │   ├── index.ts
│   │       │   ├── recall.ts          # ChunkRecall
│   │       │   ├── precision.ts       # ChunkPrecision
│   │       │   └── f1.ts              # ChunkF1
│   │       └── token-level/
│   │           ├── index.ts
│   │           ├── recall.ts          # SpanRecall
│   │           ├── precision.ts       # SpanPrecision
│   │           ├── iou.ts             # SpanIoU
│   │           └── utils.ts           # Span merging utilities
│   │
│   ├── langsmith/
│   │   ├── index.ts
│   │   ├── client.ts                  # LangSmith client wrapper
│   │   ├── schemas.ts                 # Dataset schemas
│   │   └── upload.ts                  # Upload utilities
│   │
│   └── utils/
│       ├── index.ts
│       ├── hashing.ts                 # Chunk ID generation (SHA256)
│       ├── text.ts                    # Text processing utilities
│       └── span.ts                    # CharacterSpan utility functions
│
└── tests/
    ├── setup.ts                       # Test setup
    ├── fixtures.ts                    # Shared test fixtures
    ├── types/
    │   ├── chunks.test.ts
    │   └── documents.test.ts
    ├── chunkers/
    │   ├── adapter.test.ts
    │   └── recursive-character.test.ts
    ├── evaluation/
    │   └── metrics/
    │       ├── chunk-level.test.ts
    │       └── token-level.test.ts
    ├── synthetic-datagen/
    │   ├── chunk-level-generator.test.ts
    │   └── token-level-generator.test.ts
    └── integration/
        ├── chunk-level-workflow.test.ts
        └── token-level-workflow.test.ts
```

### 1.3 package.json Configuration

```json
{
  "name": "rag-evaluation-system",
  "version": "0.1.0",
  "description": "A comprehensive framework for evaluating RAG retrieval pipelines",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "keywords": ["rag", "evaluation", "retrieval", "llm", "langsmith", "typescript"],
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src tests",
    "lint:fix": "eslint src tests --fix",
    "format": "prettier --write src tests",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm build"
  },
  "dependencies": {
    "zod": "^3.23"
  },
  "peerDependencies": {
    "langsmith": "^0.5.0"
  },
  "peerDependenciesMeta": {
    "langsmith": { "optional": true }
  },
  "optionalDependencies": {
    "openai": ">=4.0",
    "cohere-ai": ">=7.0",
    "chromadb": ">=1.8"
  },
  "devDependencies": {
    "typescript": "^5.4",
    "tsup": "^8.0",
    "vitest": "^1.6",
    "@vitest/coverage-v8": "^1.6",
    "eslint": "^9.0",
    "typescript-eslint": "^8.0",
    "prettier": "^3.2",
    "langsmith": "^0.5.0"
  }
}
```

### 1.4 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 1.5 tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
});
```

### 1.6 vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/**/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

### 1.7 Install Dependencies

```bash
pnpm install

# Install dev dependencies
pnpm add -D typescript tsup vitest @vitest/coverage-v8 eslint prettier typescript-eslint

# Install core dependency
pnpm add zod

# Install optional peer deps for development
pnpm add -D openai cohere-ai chromadb langsmith
```

---

## 2. Core Types Module

### 2.1 Brand Utility (`types/brand.ts`)

**Purpose**: Enable nominal typing in TypeScript's structural type system.

```typescript
/**
 * Branded type utility for creating nominal types.
 * Prevents accidentally passing a ChunkId where a DocumentId is expected.
 *
 * Usage:
 *   type DocumentId = Brand<"DocumentId", string>;
 *   const docId = "test.md" as DocumentId;
 */
declare const __brand: unique symbol;

export type Brand<K extends string, T> = T & { readonly [__brand]: K };
```

### 2.2 Primitive Types (`types/primitives.ts`)

**Purpose**: Define semantic branded type aliases.

```typescript
import type { Brand } from "./brand";

export type DocumentId = Brand<"DocumentId", string>;
export type QueryId = Brand<"QueryId", string>;
export type QueryText = Brand<"QueryText", string>;
export type ChunkId = Brand<"ChunkId", string>;
export type PositionAwareChunkId = Brand<"PositionAwareChunkId", string>;
export type EvaluationType = "chunk-level" | "token-level";

// Factory functions for creating branded values
export const DocumentId = (value: string) => value as DocumentId;
export const QueryId = (value: string) => value as QueryId;
export const QueryText = (value: string) => value as QueryText;
export const ChunkId = (value: string) => value as ChunkId;
export const PositionAwareChunkId = (value: string) => value as PositionAwareChunkId;
```

**Key Design Decisions**:
- Branded types provide compile-time safety with zero runtime cost
- Factory functions make creating branded values ergonomic
- Prefixed IDs (`chunk_`, `pa_chunk_`) for visual disambiguation

### 2.3 Document Types (`types/documents.ts`)

**Purpose**: Define `Document` and `Corpus` types with Zod validation.

```typescript
import { z } from "zod";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { glob } from "node:fs/promises"; // Node 22+ or use fast-glob package
import type { DocumentId } from "./primitives";

// Zod schemas for runtime validation
export const DocumentSchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).default({}),
}).readonly();

export const CorpusSchema = z.object({
  documents: z.array(DocumentSchema).readonly(),
  metadata: z.record(z.unknown()).default({}),
}).readonly();

// TypeScript interfaces
export interface Document {
  readonly id: DocumentId;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Corpus {
  readonly documents: readonly Document[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

// Factory functions
export function createDocument(params: {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Document {
  return {
    id: params.id as DocumentId,
    content: params.content,
    metadata: Object.freeze(params.metadata ?? {}),
  };
}

export function createCorpus(documents: Document[], metadata?: Record<string, unknown>): Corpus {
  return {
    documents: Object.freeze([...documents]),
    metadata: Object.freeze(metadata ?? {}),
  };
}

/**
 * Load all markdown files from a folder into a Corpus.
 */
export async function corpusFromFolder(
  folderPath: string,
  globPattern: string = "**/*.md",
): Promise<Corpus> {
  // Implementation: use fast-glob or Node fs to find matching files
  // Read each file, create Document with filename as ID
  // Return frozen Corpus
}

export function getDocument(corpus: Corpus, docId: DocumentId): Document | undefined {
  return corpus.documents.find((doc) => doc.id === docId);
}
```

### 2.4 Chunk Types (`types/chunks.ts`)

**Purpose**: Define `Chunk`, `PositionAwareChunk`, and `CharacterSpan`.

```typescript
import { z } from "zod";
import type { DocumentId, ChunkId, PositionAwareChunkId } from "./primitives";

// Zod schemas for runtime validation
export const CharacterSpanSchema = z.object({
  docId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
}).refine(
  (data) => data.end > data.start,
  { message: "end must be greater than start" },
).refine(
  (data) => data.text.length === data.end - data.start,
  { message: "text length must match span length (end - start)" },
);

// TypeScript interfaces
export interface CharacterSpan {
  readonly docId: DocumentId;
  readonly start: number;  // inclusive, 0-indexed
  readonly end: number;    // exclusive
  readonly text: string;
}

export interface Chunk {
  readonly id: ChunkId;
  readonly content: string;
  readonly docId: DocumentId;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface PositionAwareChunk {
  readonly id: PositionAwareChunkId;
  readonly content: string;
  readonly docId: DocumentId;
  readonly start: number;
  readonly end: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// Factory with validation
export function createCharacterSpan(params: {
  docId: string;
  start: number;
  end: number;
  text: string;
}): CharacterSpan {
  CharacterSpanSchema.parse(params);
  return {
    docId: params.docId as DocumentId,
    start: params.start,
    end: params.end,
    text: params.text,
  };
}

export function positionAwareChunkToSpan(chunk: PositionAwareChunk): CharacterSpan {
  return {
    docId: chunk.docId,
    start: chunk.start,
    end: chunk.end,
    text: chunk.content,
  };
}
```

### 2.5 Query Types (`types/queries.ts`)

```typescript
import type { QueryId, QueryText } from "./primitives";

export interface Query {
  readonly id: QueryId;
  readonly text: QueryText;
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

### 2.6 Ground Truth Types (`types/ground-truth.ts`)

```typescript
import type { ChunkId, QueryText } from "./primitives";
import type { Query } from "./queries";
import type { CharacterSpan } from "./chunks";

export interface ChunkLevelGroundTruth {
  readonly query: Query;
  readonly relevantChunkIds: readonly ChunkId[];
}

export interface TokenLevelGroundTruth {
  readonly query: Query;
  readonly relevantSpans: readonly CharacterSpan[];
}

// LangSmith dataset example schemas
export interface ChunkLevelDatasetExample {
  inputs: { query: string };
  outputs: { relevantChunkIds: string[] };
  metadata: Record<string, unknown>;
}

export interface TokenLevelDatasetExample {
  inputs: { query: string };
  outputs: { relevantSpans: Array<{ docId: string; start: number; end: number; text: string }> };
  metadata: Record<string, unknown>;
}
```

### 2.7 Result Types (`types/results.ts`)

```typescript
import type { ChunkId } from "./primitives";
import type { CharacterSpan } from "./chunks";

export interface EvaluationResult {
  metrics: Record<string, number>;
  experimentUrl?: string;
  rawResults?: unknown;
}

export interface ChunkLevelRunOutput {
  retrievedChunkIds: ChunkId[];
}

export interface TokenLevelRunOutput {
  retrievedSpans: CharacterSpan[];
}
```

### 2.8 Module Exports (`types/index.ts`)

Re-export everything from all type files.

---

## 3. Chunker Interfaces

### 3.1 Base Interfaces (`chunkers/chunker.interface.ts`)

```typescript
import type { Document, PositionAwareChunk } from "../types";

export interface Chunker {
  readonly name: string;
  chunk(text: string): string[];
}

export interface PositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): PositionAwareChunk[];
}

/**
 * Type guard to check if a chunker is position-aware.
 */
export function isPositionAwareChunker(
  chunker: Chunker | PositionAwareChunker,
): chunker is PositionAwareChunker {
  return "chunkWithPositions" in chunker;
}
```

### 3.2 Position Adapter (`chunkers/adapter.ts`)

```typescript
import type { Document, PositionAwareChunk } from "../types";
import { generatePaChunkId } from "../utils/hashing";
import type { Chunker, PositionAwareChunker } from "./chunker.interface";

export class ChunkerPositionAdapter implements PositionAwareChunker {
  readonly name: string;
  private _chunker: Chunker;
  private _skippedChunks = 0;

  constructor(chunker: Chunker) {
    this._chunker = chunker;
    this.name = `PositionAdapter(${chunker.name})`;
  }

  get skippedChunks(): number {
    return this._skippedChunks;
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    const chunks = this._chunker.chunk(doc.content);
    const result: PositionAwareChunk[] = [];
    let currentPos = 0;

    for (const chunkText of chunks) {
      let start = doc.content.indexOf(chunkText, currentPos);

      if (start === -1) {
        start = doc.content.indexOf(chunkText);
      }

      if (start === -1) {
        console.warn(
          `Could not locate chunk in source document '${doc.id}'. ` +
          `Chunk preview: ${chunkText.substring(0, 50)}...`,
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

### 3.3 Hashing Utilities (`utils/hashing.ts`)

```typescript
import { createHash } from "node:crypto";
import { ChunkId, PositionAwareChunkId } from "../types/primitives";

export function generateChunkId(content: string): ChunkId {
  const hash = createHash("sha256").update(content, "utf-8").digest("hex").substring(0, 12);
  return ChunkId(`chunk_${hash}`);
}

export function generatePaChunkId(content: string): PositionAwareChunkId {
  const hash = createHash("sha256").update(content, "utf-8").digest("hex").substring(0, 12);
  return PositionAwareChunkId(`pa_chunk_${hash}`);
}
```

### 3.4 RecursiveCharacterChunker (`chunkers/recursive-character.ts`)

```typescript
import type { Document, PositionAwareChunk } from "../types";
import { generatePaChunkId } from "../utils/hashing";
import type { Chunker, PositionAwareChunker } from "./chunker.interface";

export interface RecursiveCharacterChunkerOptions {
  chunkSize?: number;      // default: 1000
  chunkOverlap?: number;   // default: 200
  separators?: string[];
}

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

export class RecursiveCharacterChunker implements Chunker, PositionAwareChunker {
  readonly name: string;
  private _chunkSize: number;
  private _chunkOverlap: number;
  private _separators: string[];

  constructor(options: RecursiveCharacterChunkerOptions = {}) {
    this._chunkSize = options.chunkSize ?? 1000;
    this._chunkOverlap = options.chunkOverlap ?? 200;
    this._separators = options.separators ?? DEFAULT_SEPARATORS;

    if (this._chunkOverlap >= this._chunkSize) {
      throw new Error("chunkOverlap must be less than chunkSize");
    }

    this.name = `RecursiveCharacter(size=${this._chunkSize}, overlap=${this._chunkOverlap})`;
  }

  chunk(text: string): string[] {
    return this._splitText(text, this._separators);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    const chunksWithPos = this._splitTextWithPositions(doc.content, this._separators);
    return chunksWithPos.map(([text, start, end]) => ({
      id: generatePaChunkId(text),
      content: text,
      docId: doc.id,
      start,
      end,
      metadata: {},
    }));
  }

  private _splitText(text: string, separators: string[]): string[] {
    // Implementation: standard recursive character splitting algorithm
    // ...
  }

  private _splitTextWithPositions(
    text: string,
    separators: string[],
  ): Array<[string, number, number]> {
    // Same algorithm but track character positions
    // Returns [chunkText, startPos, endPos]
    // ...
  }
}
```

---

## 4. Embedder & Vector Store Interfaces

### 4.1 Embedder Interface (`embedders/embedder.interface.ts`)

```typescript
export interface Embedder {
  readonly name: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}
```

### 4.2 OpenAI Embedder (`embedders/openai.ts`)

```typescript
import type { Embedder } from "./embedder.interface";

export class OpenAIEmbedder implements Embedder {
  readonly name: string;
  readonly dimension: number;
  private _model: string;
  private _client: any; // OpenAI client

  constructor(options: { model?: string; client?: any } = {}) {
    this._model = options.model ?? "text-embedding-3-small";
    this.name = `OpenAI(${this._model})`;

    const knownDims: Record<string, number> = {
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
    };
    this.dimension = knownDims[this._model] ?? 1536;

    // Lazy-load OpenAI to keep it optional
    // NOTE: Client must be provided OR initialized via static async factory.
    // require() does not work in ESM. Use dynamic import instead.
    if (options.client) {
      this._client = options.client;
    }
  }

  /**
   * Factory for creating an OpenAIEmbedder without a pre-built client.
   * Use this instead of relying on require() in ESM.
   */
  static async create(options: { model?: string } = {}): Promise<OpenAIEmbedder> {
    try {
      const { default: OpenAI } = await import("openai");
      return new OpenAIEmbedder({ ...options, client: new OpenAI() });
    } catch {
      throw new Error("OpenAI package required. Install with: pnpm add openai");
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this._client.embeddings.create({
      model: this._model,
      input: texts,
    });
    return response.data.map((item: any) => item.embedding);
  }

  async embedQuery(query: string): Promise<number[]> {
    const result = await this.embed([query]);
    return result[0];
  }
}
```

### 4.3 Vector Store Interface (`vector-stores/vector-store.interface.ts`)

```typescript
import type { PositionAwareChunk } from "../types";

export interface VectorStore {
  readonly name: string;
  add(chunks: PositionAwareChunk[], embeddings: number[][]): Promise<void>;
  search(queryEmbedding: number[], k?: number): Promise<PositionAwareChunk[]>;
  clear(): Promise<void>;
}
```

### 4.4 Chroma Vector Store (`vector-stores/chroma.ts`)

```typescript
import type { PositionAwareChunk } from "../types";
import { PositionAwareChunkId, DocumentId } from "../types/primitives";
import type { VectorStore } from "./vector-store.interface";
import { randomUUID } from "node:crypto";

export class ChromaVectorStore implements VectorStore {
  readonly name: string;
  private _collectionName: string;
  private _client: any;
  private _collection: any;

  constructor(options: { collectionName?: string; persistDirectory?: string } = {}) {
    this._collectionName = options.collectionName ?? `rag_eval_${randomUUID().substring(0, 8)}`;
    this.name = `Chroma(${this._collectionName})`;

    try {
      const { ChromaClient } = require("chromadb");
      this._client = new ChromaClient();
    } catch {
      throw new Error("chromadb package required. Install with: pnpm add chromadb");
    }
  }

  private async _ensureCollection(): Promise<void> {
    if (!this._collection) {
      this._collection = await this._client.getOrCreateCollection({
        name: this._collectionName,
        metadata: { "hnsw:space": "cosine" },
      });
    }
  }

  async add(chunks: PositionAwareChunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length === 0) return;
    await this._ensureCollection();

    await this._collection.add({
      ids: chunks.map((c) => String(c.id)),
      embeddings,
      documents: chunks.map((c) => c.content),
      metadatas: chunks.map((c) => ({
        docId: String(c.docId),
        start: c.start,
        end: c.end,
        ...c.metadata,
      })),
    });
  }

  async search(queryEmbedding: number[], k: number = 5): Promise<PositionAwareChunk[]> {
    await this._ensureCollection();

    const results = await this._collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: k,
      include: ["documents", "metadatas"],
    });

    if (!results.ids[0]?.length) return [];

    return results.ids[0].map((id: string, i: number) => {
      const metadata = results.metadatas[0][i];
      return {
        id: PositionAwareChunkId(id),
        content: results.documents[0][i],
        docId: DocumentId(metadata.docId),
        start: metadata.start,
        end: metadata.end,
        metadata: {},
      };
    });
  }

  async clear(): Promise<void> {
    await this._client.deleteCollection(this._collectionName);
    this._collection = null;
  }
}
```

---

## 5. Reranker Interface

### 5.1 Reranker Interface (`rerankers/reranker.interface.ts`)

```typescript
import type { PositionAwareChunk } from "../types";

export interface Reranker {
  readonly name: string;
  rerank(
    query: string,
    chunks: PositionAwareChunk[],
    topK?: number,
  ): Promise<PositionAwareChunk[]>;
}
```

### 5.2 Cohere Reranker (`rerankers/cohere.ts`)

```typescript
import type { PositionAwareChunk } from "../types";
import type { Reranker } from "./reranker.interface";

export class CohereReranker implements Reranker {
  readonly name: string;
  private _model: string;
  private _client: any;

  constructor(options: { model?: string; client?: any } = {}) {
    this._model = options.model ?? "rerank-english-v3.0";
    this.name = `Cohere(${this._model})`;

    if (options.client) {
      this._client = options.client;
    } else {
      try {
        const { CohereClient } = require("cohere-ai");
        this._client = new CohereClient();
      } catch {
        throw new Error("cohere-ai package required. Install with: pnpm add cohere-ai");
      }
    }
  }

  async rerank(
    query: string,
    chunks: PositionAwareChunk[],
    topK?: number,
  ): Promise<PositionAwareChunk[]> {
    if (chunks.length === 0) return [];

    const response = await this._client.rerank({
      model: this._model,
      query,
      documents: chunks.map((c) => c.content),
      topN: topK ?? chunks.length,
    });

    return response.results.map((r: any) => chunks[r.index]);
  }
}
```

---

## 6. Synthetic Data Generation

### 6.1 Base Generator (`synthetic-datagen/base.ts`)

```typescript
import type { Corpus } from "../types";

export interface LLMClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        response_format?: { type: string };
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}

export abstract class SyntheticDatasetGenerator {
  protected _llm: LLMClient;
  protected _corpus: Corpus;
  protected _model: string;

  constructor(llmClient: LLMClient, corpus: Corpus, model = "gpt-4o") {
    this._llm = llmClient;
    this._corpus = corpus;
    this._model = model;
  }

  get corpus(): Corpus {
    return this._corpus;
  }

  protected async callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this._llm.chat.completions.create({
      model: this._model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });
    return response.choices[0].message.content ?? "";
  }
}
```

### 6.2 Chunk-Level Generator (`synthetic-datagen/chunk-level/generator.ts`)

```typescript
import type { Corpus, ChunkId, ChunkLevelGroundTruth, Query } from "../../types";
import { QueryId, QueryText } from "../../types/primitives";
import type { Chunker } from "../../chunkers/chunker.interface";
import { generateChunkId } from "../../utils/hashing";
import { SyntheticDatasetGenerator, type LLMClient } from "../base";

interface GenerateOptions {
  queriesPerDoc?: number;
  uploadToLangsmith?: boolean;
  datasetName?: string;
}

export class ChunkLevelSyntheticDatasetGenerator extends SyntheticDatasetGenerator {
  private _chunker: Chunker;
  private _chunkIndex = new Map<string, string>(); // chunkId -> content

  static readonly SYSTEM_PROMPT = `You are an expert at generating evaluation data for RAG systems.
Given chunks from a document with their IDs, generate questions that can be answered using specific chunks.
For each question, list the chunk IDs that contain the answer.

Output JSON format:
{
  "qa_pairs": [
    { "query": "What is...?", "relevant_chunk_ids": ["chunk_xxx", "chunk_yyy"] }
  ]
}`;

  constructor(options: { llmClient: LLMClient; corpus: Corpus; chunker: Chunker }) {
    super(options.llmClient, options.corpus);
    this._chunker = options.chunker;
  }

  async generate(options: GenerateOptions = {}): Promise<ChunkLevelGroundTruth[]> {
    const { queriesPerDoc = 5, uploadToLangsmith = true, datasetName } = options;

    // Step 1: Chunk all documents
    this._buildChunkIndex();

    // Step 2: Generate queries per document
    const groundTruth: ChunkLevelGroundTruth[] = [];

    for (const doc of this._corpus.documents) {
      const docChunks = [...this._chunkIndex.entries()].slice(0, 20);
      const qaPairs = await this._generateQAPairs(docChunks, queriesPerDoc);

      for (const qa of qaPairs) {
        const validIds = qa.relevant_chunk_ids.filter((id) => this._chunkIndex.has(id));
        if (validIds.length === 0) continue;

        groundTruth.push({
          query: {
            id: QueryId(`q_${groundTruth.length}`),
            text: QueryText(qa.query),
            metadata: { sourceDoc: String(doc.id) },
          },
          relevantChunkIds: validIds.map((id) => id as ChunkId),
        });
      }
    }

    // Step 3: Upload to LangSmith
    if (uploadToLangsmith) {
      const { uploadChunkLevelDataset } = await import("../../langsmith/upload");
      await uploadChunkLevelDataset(groundTruth, datasetName);
    }

    return groundTruth;
  }

  private _buildChunkIndex(): void {
    for (const doc of this._corpus.documents) {
      const chunks = this._chunker.chunk(doc.content);
      for (const chunkText of chunks) {
        const chunkId = generateChunkId(chunkText);
        this._chunkIndex.set(String(chunkId), chunkText);
      }
    }
  }

  private async _generateQAPairs(
    chunks: Array<[string, string]>,
    numQueries: number,
  ): Promise<Array<{ query: string; relevant_chunk_ids: string[] }>> {
    const chunkText = chunks
      .map(([id, content]) => `[${id}]: ${content.substring(0, 500)}...`)
      .join("\n");

    const prompt = `Here are chunks from a document:\n\n${chunkText}\n\nGenerate ${numQueries} diverse questions.`;
    const response = await this.callLLM(ChunkLevelSyntheticDatasetGenerator.SYSTEM_PROMPT, prompt);
    const data = JSON.parse(response);
    return data.qa_pairs ?? [];
  }
}
```

### 6.3 Token-Level Generator (`synthetic-datagen/token-level/generator.ts`)

```typescript
import type { Corpus, Document, CharacterSpan, TokenLevelGroundTruth } from "../../types";
import { QueryId, QueryText, DocumentId } from "../../types/primitives";
import { createCharacterSpan } from "../../types/chunks";
import { SyntheticDatasetGenerator, type LLMClient } from "../base";

interface GenerateOptions {
  queriesPerDoc?: number;
  uploadToLangsmith?: boolean;
  datasetName?: string;
}

export class TokenLevelSyntheticDatasetGenerator extends SyntheticDatasetGenerator {
  static readonly QUERY_PROMPT = `You are an expert at generating evaluation questions.
Given a document, generate diverse questions answerable from specific passages.

Output JSON: { "questions": ["What is...?", "How does...?", ...] }`;

  static readonly EXCERPT_PROMPT = `You are an expert at identifying relevant text.
Given a document and question, extract exact passages that answer it.
Copy text VERBATIM - do not paraphrase.

Output JSON: { "excerpts": ["exact text from document...", ...] }`;

  constructor(options: { llmClient: LLMClient; corpus: Corpus }) {
    super(options.llmClient, options.corpus);
  }

  async generate(options: GenerateOptions = {}): Promise<TokenLevelGroundTruth[]> {
    const { queriesPerDoc = 5, uploadToLangsmith = true, datasetName } = options;

    const groundTruth: TokenLevelGroundTruth[] = [];
    let queryCounter = 0;

    for (const doc of this._corpus.documents) {
      const questions = await this._generateQuestions(doc, queriesPerDoc);

      for (const question of questions) {
        const excerpts = await this._extractExcerpts(doc, question);
        const spans = this._findSpanPositions(doc, excerpts);

        if (spans.length === 0) continue;

        groundTruth.push({
          query: {
            id: QueryId(`q_${queryCounter++}`),
            text: QueryText(question),
            metadata: { sourceDoc: String(doc.id) },
          },
          relevantSpans: spans,
        });
      }
    }

    if (uploadToLangsmith) {
      const { uploadTokenLevelDataset } = await import("../../langsmith/upload");
      await uploadTokenLevelDataset(groundTruth, datasetName);
    }

    return groundTruth;
  }

  private async _generateQuestions(doc: Document, numQueries: number): Promise<string[]> {
    const prompt = `Document:\n${doc.content.substring(0, 8000)}\n\nGenerate ${numQueries} diverse questions.`;
    const response = await this.callLLM(
      TokenLevelSyntheticDatasetGenerator.QUERY_PROMPT,
      prompt,
    );
    return JSON.parse(response).questions ?? [];
  }

  private async _extractExcerpts(doc: Document, question: string): Promise<string[]> {
    const prompt = `Document:\n${doc.content.substring(0, 8000)}\n\nQuestion: ${question}\n\nExtract exact passages.`;
    const response = await this.callLLM(
      TokenLevelSyntheticDatasetGenerator.EXCERPT_PROMPT,
      prompt,
    );
    return JSON.parse(response).excerpts ?? [];
  }

  private _findSpanPositions(doc: Document, excerpts: string[]): CharacterSpan[] {
    const spans: CharacterSpan[] = [];

    for (const excerpt of excerpts) {
      let start = doc.content.indexOf(excerpt);

      if (start === -1) {
        start = this._fuzzyFind(doc.content, excerpt);
      }

      if (start === -1) {
        console.warn(`Could not locate excerpt in document ${doc.id}: ${excerpt.substring(0, 50)}...`);
        continue;
      }

      const end = start + excerpt.length;
      spans.push(createCharacterSpan({
        docId: String(doc.id),
        start,
        end,
        text: doc.content.substring(start, end),
      }));
    }

    return spans;
  }

  private _fuzzyFind(text: string, excerpt: string, _threshold = 0.9): number {
    // Implementation: sliding window with similarity scoring
    return -1;
  }
}
```

---

## 7. Metrics Implementation

### 7.1 Base Metric Interfaces (`evaluation/metrics/base.ts`)

```typescript
import type { ChunkId } from "../../types/primitives";
import type { CharacterSpan } from "../../types/chunks";

export interface ChunkLevelMetric {
  readonly name: string;
  calculate(retrievedChunkIds: ChunkId[], groundTruthChunkIds: ChunkId[]): number;
}

export interface TokenLevelMetric {
  readonly name: string;
  calculate(retrievedSpans: CharacterSpan[], groundTruthSpans: CharacterSpan[]): number;
}
```

### 7.2 Chunk-Level Metrics (`evaluation/metrics/chunk-level/`)

**recall.ts**:
```typescript
import type { ChunkId } from "../../../types/primitives";
import type { ChunkLevelMetric } from "../base";

export class ChunkRecall implements ChunkLevelMetric {
  readonly name = "chunk_recall";

  calculate(retrievedChunkIds: ChunkId[], groundTruthChunkIds: ChunkId[]): number {
    if (groundTruthChunkIds.length === 0) return 0.0;
    const retrieved = new Set(retrievedChunkIds);
    const gt = new Set(groundTruthChunkIds);
    const intersection = [...gt].filter((id) => retrieved.has(id));
    return intersection.length / gt.size;
  }
}
```

**precision.ts**:
```typescript
import type { ChunkId } from "../../../types/primitives";
import type { ChunkLevelMetric } from "../base";

export class ChunkPrecision implements ChunkLevelMetric {
  readonly name = "chunk_precision";

  calculate(retrievedChunkIds: ChunkId[], groundTruthChunkIds: ChunkId[]): number {
    if (retrievedChunkIds.length === 0) return 0.0;
    const retrieved = new Set(retrievedChunkIds);
    const gt = new Set(groundTruthChunkIds);
    const intersection = [...retrieved].filter((id) => gt.has(id));
    return intersection.length / retrieved.size;
  }
}
```

**f1.ts**:
```typescript
import type { ChunkId } from "../../../types/primitives";
import type { ChunkLevelMetric } from "../base";
import { ChunkRecall } from "./recall";
import { ChunkPrecision } from "./precision";

export class ChunkF1 implements ChunkLevelMetric {
  readonly name = "chunk_f1";
  private _recall = new ChunkRecall();
  private _precision = new ChunkPrecision();

  calculate(retrievedChunkIds: ChunkId[], groundTruthChunkIds: ChunkId[]): number {
    const recall = this._recall.calculate(retrievedChunkIds, groundTruthChunkIds);
    const precision = this._precision.calculate(retrievedChunkIds, groundTruthChunkIds);
    if (recall + precision === 0) return 0.0;
    return (2 * precision * recall) / (precision + recall);
  }
}
```

### 7.3 Token-Level Metrics

**Span Merging Utilities (`evaluation/metrics/token-level/utils.ts`)**:

```typescript
import type { CharacterSpan } from "../../../types/chunks";

export function mergeOverlappingSpans(spans: CharacterSpan[]): CharacterSpan[] {
  if (spans.length === 0) return [];

  const byDoc = new Map<string, CharacterSpan[]>();
  for (const span of spans) {
    const existing = byDoc.get(String(span.docId)) ?? [];
    existing.push(span);
    byDoc.set(String(span.docId), existing);
  }

  const merged: CharacterSpan[] = [];

  for (const [, docSpans] of byDoc) {
    const sorted = [...docSpans].sort((a, b) => a.start - b.start);
    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= current.end) {
        current = {
          docId: current.docId,
          start: current.start,
          end: Math.max(current.end, sorted[i].end),
          text: "", // placeholder
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

export function spanOverlapChars(a: CharacterSpan, b: CharacterSpan): number {
  if (String(a.docId) !== String(b.docId)) return 0;
  if (a.start >= b.end || b.start >= a.end) return 0;
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

export function spanLength(span: CharacterSpan): number {
  return span.end - span.start;
}

export function calculateOverlap(spansA: CharacterSpan[], spansB: CharacterSpan[]): number {
  const mergedA = mergeOverlappingSpans(spansA);
  const mergedB = mergeOverlappingSpans(spansB);

  let total = 0;
  for (const a of mergedA) {
    for (const b of mergedB) {
      total += spanOverlapChars(a, b);
    }
  }
  return total;
}
```

**recall.ts, precision.ts, iou.ts**: Same logic as brainstorm, implementing `TokenLevelMetric` interface with `mergeOverlappingSpans` and `calculateOverlap`.

---

## 8. Evaluation Classes

### 8.1 Chunk-Level Evaluation (`evaluation/chunk-level.ts`)

```typescript
import type { Corpus, ChunkId, EvaluationResult, ChunkLevelGroundTruth } from "../types";
import { ChunkId as ChunkIdFactory, PositionAwareChunkId, DocumentId } from "../types/primitives";
import type { Chunker } from "../chunkers/chunker.interface";
import type { Embedder } from "../embedders/embedder.interface";
import type { VectorStore } from "../vector-stores/vector-store.interface";
import type { Reranker } from "../rerankers/reranker.interface";
import type { ChunkLevelMetric } from "./metrics/base";
import { ChunkRecall } from "./metrics/chunk-level/recall";
import { ChunkPrecision } from "./metrics/chunk-level/precision";
import { ChunkF1 } from "./metrics/chunk-level/f1";
import { generateChunkId } from "../utils/hashing";

interface ChunkLevelEvaluationConfig {
  corpus: Corpus;
  langsmithDatasetName: string;
}

interface RunOptions {
  chunker: Chunker;
  embedder: Embedder;
  k?: number;
  vectorStore?: VectorStore;
  reranker?: Reranker;
  metrics?: ChunkLevelMetric[];
}

const DEFAULT_METRICS: ChunkLevelMetric[] = [
  new ChunkRecall(),
  new ChunkPrecision(),
  new ChunkF1(),
];

export class ChunkLevelEvaluation {
  private _corpus: Corpus;
  private _datasetName: string;

  constructor(config: ChunkLevelEvaluationConfig) {
    this._corpus = config.corpus;
    this._datasetName = config.langsmithDatasetName;
  }

  async run(options: RunOptions): Promise<EvaluationResult> {
    const { chunker, embedder, k = 5, reranker } = options;
    const metrics = options.metrics ?? DEFAULT_METRICS;

    // Default vector store
    let vectorStore = options.vectorStore;
    if (!vectorStore) {
      const { ChromaVectorStore } = await import("../vector-stores/chroma");
      vectorStore = new ChromaVectorStore();
    }

    // Step 1: Chunk and index
    const { chunks, chunkIds } = this._chunkCorpus(chunker);
    const embeddings = await embedder.embed(chunks);

    // Convert to PositionAwareChunk for vector store compatibility
    const paChunks = chunks.map((text, i) => ({
      id: PositionAwareChunkId(String(chunkIds[i]).replace("chunk_", "pa_chunk_")),
      content: text,
      docId: DocumentId("unknown"),
      start: 0,
      end: text.length,
      metadata: {},
    }));

    await vectorStore.add(paChunks, embeddings);

    // Step 2: Load ground truth
    const groundTruth = await this._loadGroundTruth();

    // Step 3: Evaluate
    const allResults: Record<string, number[]> = {};
    for (const m of metrics) allResults[m.name] = [];

    for (const gt of groundTruth) {
      const queryEmbedding = await embedder.embedQuery(String(gt.query.text));
      let retrievedChunks = await vectorStore.search(queryEmbedding, k);

      if (reranker) {
        retrievedChunks = await reranker.rerank(String(gt.query.text), retrievedChunks, k);
      }

      const retrievedIds = retrievedChunks.map(
        (c) => ChunkIdFactory(String(c.id).replace("pa_chunk_", "chunk_")),
      );

      for (const metric of metrics) {
        const score = metric.calculate(retrievedIds, [...gt.relevantChunkIds]);
        allResults[metric.name].push(score);
      }
    }

    // Step 4: Aggregate
    const avgMetrics: Record<string, number> = {};
    for (const [name, scores] of Object.entries(allResults)) {
      avgMetrics[name] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    }

    return { metrics: avgMetrics };
  }

  private _chunkCorpus(chunker: Chunker): { chunks: string[]; chunkIds: ChunkId[] } {
    const chunks: string[] = [];
    const chunkIds: ChunkId[] = [];

    for (const doc of this._corpus.documents) {
      for (const chunkText of chunker.chunk(doc.content)) {
        chunks.push(chunkText);
        chunkIds.push(generateChunkId(chunkText));
      }
    }

    return { chunks, chunkIds };
  }

  private async _loadGroundTruth(): Promise<ChunkLevelGroundTruth[]> {
    const { loadChunkLevelDataset } = await import("../langsmith/client");
    return loadChunkLevelDataset(this._datasetName);
  }
}
```

### 8.2 Token-Level Evaluation (`evaluation/token-level.ts`)

```typescript
import type { Corpus, CharacterSpan, EvaluationResult, TokenLevelGroundTruth } from "../types";
import type { Chunker, PositionAwareChunker } from "../chunkers/chunker.interface";
import { isPositionAwareChunker } from "../chunkers/chunker.interface";
import { ChunkerPositionAdapter } from "../chunkers/adapter";
import type { Embedder } from "../embedders/embedder.interface";
import type { VectorStore } from "../vector-stores/vector-store.interface";
import type { Reranker } from "../rerankers/reranker.interface";
import type { TokenLevelMetric } from "./metrics/base";
import { SpanRecall } from "./metrics/token-level/recall";
import { SpanPrecision } from "./metrics/token-level/precision";
import { SpanIoU } from "./metrics/token-level/iou";
import { positionAwareChunkToSpan } from "../types/chunks";

interface TokenLevelEvaluationConfig {
  corpus: Corpus;
  langsmithDatasetName: string;
}

interface RunOptions {
  chunker: Chunker | PositionAwareChunker;
  embedder: Embedder;
  k?: number;
  vectorStore?: VectorStore;
  reranker?: Reranker;
  metrics?: TokenLevelMetric[];
}

const DEFAULT_METRICS: TokenLevelMetric[] = [
  new SpanRecall(),
  new SpanPrecision(),
  new SpanIoU(),
];

export class TokenLevelEvaluation {
  private _corpus: Corpus;
  private _datasetName: string;

  constructor(config: TokenLevelEvaluationConfig) {
    this._corpus = config.corpus;
    this._datasetName = config.langsmithDatasetName;
  }

  async run(options: RunOptions): Promise<EvaluationResult> {
    const { embedder, k = 5, reranker } = options;
    const metrics = options.metrics ?? DEFAULT_METRICS;

    let vectorStore = options.vectorStore;
    if (!vectorStore) {
      const { ChromaVectorStore } = await import("../vector-stores/chroma");
      vectorStore = new ChromaVectorStore();
    }

    // Ensure position-aware chunker
    const paChunker: PositionAwareChunker = isPositionAwareChunker(options.chunker)
      ? options.chunker
      : new ChunkerPositionAdapter(options.chunker as Chunker);

    // Step 1: Chunk with positions
    const allChunks = this._corpus.documents.flatMap((doc) =>
      paChunker.chunkWithPositions(doc),
    );

    // Step 2: Embed and index
    const chunkTexts = allChunks.map((c) => c.content);
    const embeddings = await embedder.embed(chunkTexts);
    await vectorStore.add(allChunks, embeddings);

    // Step 3: Load ground truth
    const groundTruth = await this._loadGroundTruth();

    // Step 4: Evaluate
    const allResults: Record<string, number[]> = {};
    for (const m of metrics) allResults[m.name] = [];

    for (const gt of groundTruth) {
      const queryEmbedding = await embedder.embedQuery(String(gt.query.text));
      let retrievedChunks = await vectorStore.search(queryEmbedding, k);

      if (reranker) {
        retrievedChunks = await reranker.rerank(String(gt.query.text), retrievedChunks, k);
      }

      const retrievedSpans = retrievedChunks.map(positionAwareChunkToSpan);

      for (const metric of metrics) {
        const score = metric.calculate(retrievedSpans, [...gt.relevantSpans]);
        allResults[metric.name].push(score);
      }
    }

    // Step 5: Aggregate
    const avgMetrics: Record<string, number> = {};
    for (const [name, scores] of Object.entries(allResults)) {
      avgMetrics[name] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    }

    return { metrics: avgMetrics };
  }

  private async _loadGroundTruth(): Promise<TokenLevelGroundTruth[]> {
    const { loadTokenLevelDataset } = await import("../langsmith/client");
    return loadTokenLevelDataset(this._datasetName);
  }
}
```

---

## 9. LangSmith Integration

### 9.1 Client Wrapper (`langsmith/client.ts`)

```typescript
import type {
  ChunkLevelGroundTruth,
  TokenLevelGroundTruth,
  CharacterSpan,
} from "../types";
import { QueryId, QueryText, ChunkId, DocumentId } from "../types/primitives";

function getClient() {
  // Lazy-load langsmith
  const { Client } = require("langsmith");
  return new Client();
}

export async function loadChunkLevelDataset(
  datasetName: string,
): Promise<ChunkLevelGroundTruth[]> {
  const client = getClient();
  const examples = [];
  for await (const example of client.listExamples({ datasetName })) {
    examples.push(example);
  }

  return examples.map((example: any, i: number) => ({
    query: {
      id: QueryId(`q_${i}`),
      text: QueryText(example.inputs.query ?? ""),
      metadata: {},
    },
    relevantChunkIds: (example.outputs.relevantChunkIds ?? []).map(ChunkId),
  }));
}

export async function loadTokenLevelDataset(
  datasetName: string,
): Promise<TokenLevelGroundTruth[]> {
  const client = getClient();
  const examples = [];
  for await (const example of client.listExamples({ datasetName })) {
    examples.push(example);
  }

  return examples.map((example: any, i: number) => ({
    query: {
      id: QueryId(`q_${i}`),
      text: QueryText(example.inputs.query ?? ""),
      metadata: {},
    },
    relevantSpans: (example.outputs.relevantSpans ?? []).map((s: any) => ({
      docId: DocumentId(s.docId),
      start: s.start,
      end: s.end,
      text: s.text,
    })),
  }));
}
```

### 9.2 Upload Utilities (`langsmith/upload.ts`)

```typescript
import type { ChunkLevelGroundTruth, TokenLevelGroundTruth } from "../types";

function getClient() {
  const { Client } = require("langsmith");
  return new Client();
}

export async function uploadChunkLevelDataset(
  groundTruth: ChunkLevelGroundTruth[],
  datasetName?: string,
): Promise<string> {
  const client = getClient();
  const name = datasetName ?? "rag-eval-chunk-level";

  const dataset = await client.createDataset(name, {
    description: "Chunk-level RAG evaluation ground truth",
  });

  for (const gt of groundTruth) {
    await client.createExample(
      { query: String(gt.query.text) },
      { relevantChunkIds: gt.relevantChunkIds.map(String) },
      { datasetId: dataset.id, metadata: gt.query.metadata },
    );
  }

  return name;
}

export async function uploadTokenLevelDataset(
  groundTruth: TokenLevelGroundTruth[],
  datasetName?: string,
): Promise<string> {
  const client = getClient();
  const name = datasetName ?? "rag-eval-token-level";

  const dataset = await client.createDataset(name, {
    description: "Token-level RAG evaluation ground truth (character spans)",
  });

  for (const gt of groundTruth) {
    await client.createExample(
      { query: String(gt.query.text) },
      {
        relevantSpans: gt.relevantSpans.map((span) => ({
          docId: String(span.docId),
          start: span.start,
          end: span.end,
          text: span.text,
        })),
      },
      { datasetId: dataset.id, metadata: gt.query.metadata },
    );
  }

  return name;
}
```

---

## 10. Built-in Implementations

### 10.1 Additional Chunkers

**FixedTokenChunker** (`chunkers/fixed-token.ts`):
- Split by token count using `tiktoken` (via `js-tiktoken` or `@dqbd/tiktoken`)
- Parameters: `tokensPerChunk`, `overlapTokens`

**SemanticChunker** (`chunkers/semantic.ts`):
- Split by semantic similarity using embeddings
- Parameters: `embedder`, `similarityThreshold`

### 10.2 Additional Embedders

**TransformersEmbedder** (`embedders/transformers.ts`):
- Local embedding using `@xenova/transformers`
- Parameters: `modelName`

### 10.3 Package Exports (`index.ts`)

```typescript
// Types
export type {
  Document,
  Corpus,
  Chunk,
  PositionAwareChunk,
  CharacterSpan,
  Query,
  ChunkLevelGroundTruth,
  TokenLevelGroundTruth,
  EvaluationResult,
  ChunkLevelRunOutput,
  TokenLevelRunOutput,
} from "./types";

export {
  DocumentId,
  QueryId,
  QueryText,
  ChunkId,
  PositionAwareChunkId,
} from "./types/primitives";

export { createDocument, createCorpus, corpusFromFolder } from "./types/documents";
export { createCharacterSpan, positionAwareChunkToSpan } from "./types/chunks";

// Chunkers
export type { Chunker, PositionAwareChunker } from "./chunkers/chunker.interface";
export { isPositionAwareChunker } from "./chunkers/chunker.interface";
export { ChunkerPositionAdapter } from "./chunkers/adapter";
export { RecursiveCharacterChunker } from "./chunkers/recursive-character";

// Embedder
export type { Embedder } from "./embedders/embedder.interface";

// Vector Store
export type { VectorStore } from "./vector-stores/vector-store.interface";

// Reranker
export type { Reranker } from "./rerankers/reranker.interface";

// Synthetic Data Generation
export { ChunkLevelSyntheticDatasetGenerator } from "./synthetic-datagen/chunk-level/generator";
export { TokenLevelSyntheticDatasetGenerator } from "./synthetic-datagen/token-level/generator";

// Evaluation
export { ChunkLevelEvaluation } from "./evaluation/chunk-level";
export { TokenLevelEvaluation } from "./evaluation/token-level";

// Metrics
export type { ChunkLevelMetric, TokenLevelMetric } from "./evaluation/metrics/base";
export { ChunkRecall } from "./evaluation/metrics/chunk-level/recall";
export { ChunkPrecision } from "./evaluation/metrics/chunk-level/precision";
export { ChunkF1 } from "./evaluation/metrics/chunk-level/f1";
export { SpanRecall } from "./evaluation/metrics/token-level/recall";
export { SpanPrecision } from "./evaluation/metrics/token-level/precision";
export { SpanIoU } from "./evaluation/metrics/token-level/iou";

// Utils
export { generateChunkId, generatePaChunkId } from "./utils/hashing";
export { mergeOverlappingSpans, calculateOverlap } from "./evaluation/metrics/token-level/utils";
```

Optional implementations are imported dynamically:

```typescript
// Usage:
import { OpenAIEmbedder } from "rag-evaluation-system/embedders/openai";
import { ChromaVectorStore } from "rag-evaluation-system/vector-stores/chroma";
import { CohereReranker } from "rag-evaluation-system/rerankers/cohere";
```

---

## 11. Testing Strategy

### 11.1 Test Structure

```
tests/
├── setup.ts                            # Global test setup
├── fixtures.ts                         # Shared test fixtures
├── unit/
│   ├── types/
│   │   ├── character-span.test.ts
│   │   └── corpus.test.ts
│   ├── chunkers/
│   │   ├── adapter.test.ts
│   │   └── recursive-character.test.ts
│   ├── metrics/
│   │   ├── chunk-metrics.test.ts
│   │   └── span-metrics.test.ts
│   └── utils/
│       └── hashing.test.ts
├── integration/
│   ├── chunk-level-workflow.test.ts
│   └── token-level-workflow.test.ts
└── e2e/
    └── full-evaluation.test.ts
```

### 11.2 Shared Fixtures (`tests/fixtures.ts`)

```typescript
import type { Document, Corpus, CharacterSpan } from "../src/types";
import { DocumentId, PositionAwareChunkId } from "../src/types/primitives";
import type { Embedder } from "../src/embedders/embedder.interface";
import type { PositionAwareChunk } from "../src/types";

export function sampleDocument(): Document {
  return {
    id: DocumentId("test_doc.md"),
    content: "This is a test document. It has multiple sentences. Each sentence can be a chunk.",
    metadata: {},
  };
}

export function sampleCorpus(): Corpus {
  return {
    documents: [sampleDocument()],
    metadata: {},
  };
}

export function sampleSpans(): CharacterSpan[] {
  return [
    { docId: DocumentId("doc1"), start: 0, end: 50, text: "x".repeat(50) },
    { docId: DocumentId("doc1"), start: 30, end: 80, text: "x".repeat(50) }, // overlapping
    { docId: DocumentId("doc2"), start: 0, end: 100, text: "x".repeat(100) },
  ];
}

export function mockEmbedder(): Embedder {
  return {
    name: "MockEmbedder",
    dimension: 128,
    async embed(texts: string[]) {
      return texts.map(() => new Array(128).fill(0.1));
    },
    async embedQuery(_query: string) {
      return new Array(128).fill(0.1);
    },
  };
}
```

### 11.3 Unit Test Examples

**character-span.test.ts**:

```typescript
import { describe, it, expect } from "vitest";
import { createCharacterSpan } from "../../src/types/chunks";
import { DocumentId } from "../../src/types/primitives";
import { spanOverlapChars } from "../../src/evaluation/metrics/token-level/utils";

describe("CharacterSpan", () => {
  it("should calculate length correctly", () => {
    const span = createCharacterSpan({
      docId: "doc1",
      start: 10,
      end: 50,
      text: "x".repeat(40),
    });
    expect(span.end - span.start).toBe(40);
  });

  it("should detect overlap in same document", () => {
    const span1: CharacterSpan = { docId: DocumentId("doc1"), start: 0, end: 50, text: "x".repeat(50) };
    const span2: CharacterSpan = { docId: DocumentId("doc1"), start: 30, end: 80, text: "x".repeat(50) };
    expect(spanOverlapChars(span1, span2)).toBe(20);
  });

  it("should not overlap across different documents", () => {
    const span1: CharacterSpan = { docId: DocumentId("doc1"), start: 0, end: 50, text: "x".repeat(50) };
    const span2: CharacterSpan = { docId: DocumentId("doc2"), start: 0, end: 50, text: "x".repeat(50) };
    expect(spanOverlapChars(span1, span2)).toBe(0);
  });

  it("should reject end <= start", () => {
    expect(() =>
      createCharacterSpan({ docId: "doc1", start: 50, end: 10, text: "x" }),
    ).toThrow();
  });

  it("should reject text length mismatch", () => {
    expect(() =>
      createCharacterSpan({ docId: "doc1", start: 0, end: 50, text: "x".repeat(10) }),
    ).toThrow();
  });
});
```

**span-metrics.test.ts**:

```typescript
import { describe, it, expect } from "vitest";
import type { CharacterSpan } from "../../src/types";
import { DocumentId } from "../../src/types/primitives";
import { SpanRecall } from "../../src/evaluation/metrics/token-level/recall";
import { SpanPrecision } from "../../src/evaluation/metrics/token-level/precision";
import { SpanIoU } from "../../src/evaluation/metrics/token-level/iou";
import { mergeOverlappingSpans } from "../../src/evaluation/metrics/token-level/utils";

describe("mergeOverlappingSpans", () => {
  it("should merge overlapping spans", () => {
    const spans: CharacterSpan[] = [
      { docId: DocumentId("doc1"), start: 0, end: 50, text: "" },
      { docId: DocumentId("doc1"), start: 30, end: 80, text: "" },
    ];
    const merged = mergeOverlappingSpans(spans);
    expect(merged).toHaveLength(1);
    expect(merged[0].start).toBe(0);
    expect(merged[0].end).toBe(80);
  });

  it("should not merge non-overlapping spans", () => {
    const spans: CharacterSpan[] = [
      { docId: DocumentId("doc1"), start: 0, end: 50, text: "" },
      { docId: DocumentId("doc1"), start: 100, end: 150, text: "" },
    ];
    const merged = mergeOverlappingSpans(spans);
    expect(merged).toHaveLength(2);
  });
});

describe("SpanRecall", () => {
  const metric = new SpanRecall();

  it("should return 1.0 for perfect recall", () => {
    const gt: CharacterSpan[] = [{ docId: DocumentId("doc1"), start: 0, end: 100, text: "x".repeat(100) }];
    const retrieved: CharacterSpan[] = [{ docId: DocumentId("doc1"), start: 0, end: 100, text: "x".repeat(100) }];
    expect(metric.calculate(retrieved, gt)).toBe(1.0);
  });

  it("should return 0.5 for partial recall", () => {
    const gt: CharacterSpan[] = [{ docId: DocumentId("doc1"), start: 0, end: 100, text: "x".repeat(100) }];
    const retrieved: CharacterSpan[] = [{ docId: DocumentId("doc1"), start: 0, end: 50, text: "x".repeat(50) }];
    expect(metric.calculate(retrieved, gt)).toBe(0.5);
  });
});

describe("SpanIoU", () => {
  const metric = new SpanIoU();

  it("should compute partial overlap IoU", () => {
    const gt: CharacterSpan[] = [{ docId: DocumentId("doc1"), start: 0, end: 100, text: "x".repeat(100) }];
    const retrieved: CharacterSpan[] = [{ docId: DocumentId("doc1"), start: 50, end: 150, text: "x".repeat(100) }];
    // Intersection: 50, Union: 150, IoU: 50/150 ≈ 0.333
    expect(metric.calculate(retrieved, gt)).toBeCloseTo(0.333, 2);
  });
});
```

### 11.4 Running Tests

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm vitest run tests/unit/metrics/span-metrics.test.ts

# Run in watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Lint
pnpm lint
```

---

## 12. Package Publishing

### 12.1 Build Package

```bash
pnpm build
```

### 12.2 Publish to npm

```bash
# Publish (requires npm login)
pnpm publish --access public

# Or with dry run first
pnpm publish --dry-run
```

### 12.3 Version Management

Use semantic versioning:
- `0.1.0` - Initial release
- `0.1.1` - Bug fixes
- `0.2.0` - New features (backward compatible)
- `1.0.0` - Stable API

---

## Implementation Checklist

### Phase 1: Project Foundation
- [ ] Initialize project with `pnpm init`
- [ ] Configure `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- [ ] Set up ESLint and Prettier
- [ ] Create directory structure
- [ ] Set up CI (GitHub Actions)

### Phase 2: Core Types
- [ ] Implement `types/brand.ts`
- [ ] Implement `types/primitives.ts` with branded types
- [ ] Implement `types/documents.ts` with Zod schemas
- [ ] Implement `types/chunks.ts` with CharacterSpan validation
- [ ] Implement `types/queries.ts`
- [ ] Implement `types/ground-truth.ts`
- [ ] Implement `types/results.ts`
- [ ] Write unit tests for all types

### Phase 3: Chunkers
- [ ] Implement `chunkers/chunker.interface.ts` with type guard
- [ ] Implement `chunkers/adapter.ts`
- [ ] Implement `chunkers/recursive-character.ts`
- [ ] Implement `utils/hashing.ts`
- [ ] Write tests for adapter and recursive chunker

### Phase 4: Embedders & Vector Stores
- [ ] Implement `embedders/embedder.interface.ts`
- [ ] Implement `embedders/openai.ts`
- [ ] Implement `vector-stores/vector-store.interface.ts`
- [ ] Implement `vector-stores/chroma.ts`
- [ ] Write tests with mock embedders

### Phase 5: Rerankers
- [ ] Implement `rerankers/reranker.interface.ts`
- [ ] Implement `rerankers/cohere.ts`
- [ ] Write tests

### Phase 6: Metrics
- [ ] Implement `evaluation/metrics/base.ts`
- [ ] Implement chunk-level metrics (recall, precision, F1)
- [ ] Implement `evaluation/metrics/token-level/utils.ts` (span merging)
- [ ] Implement token-level metrics (recall, precision, IoU)
- [ ] Write comprehensive metric tests

### Phase 7: Synthetic Data Generation
- [ ] Implement `synthetic-datagen/base.ts`
- [ ] Implement `synthetic-datagen/chunk-level/generator.ts`
- [ ] Implement `synthetic-datagen/token-level/generator.ts`
- [ ] Write tests with mocked LLM responses

### Phase 8: LangSmith Integration
- [ ] Implement `langsmith/client.ts`
- [ ] Implement `langsmith/upload.ts`
- [ ] Write integration tests

### Phase 9: Evaluation Orchestrators
- [ ] Implement `evaluation/chunk-level.ts`
- [ ] Implement `evaluation/token-level.ts`
- [ ] Write integration tests

### Phase 10: Package & Documentation
- [ ] Create package `index.ts` with exports
- [ ] Configure `package.json` exports field for subpath imports
- [ ] Write usage examples in README
- [ ] Build and test package locally
- [ ] Publish to npm

---

## Summary

This implementation plan provides a comprehensive roadmap for building the RAG Evaluation System in TypeScript:

1. **Modern Tooling**: pnpm for packages, tsup for building, Vitest for testing, ESLint + Prettier for code quality
2. **Type Safety**: Branded types for nominal safety, Zod for runtime validation, strict TypeScript config
3. **Clean Architecture**: Interfaces over abstract classes, optional peer dependencies with dynamic imports
4. **Two Evaluation Paradigms**: Chunk-level (simpler) and Token-level (more granular)
5. **Extensible Design**: Easy to add new chunkers, embedders, vector stores, and metrics
6. **Async-First**: All I/O operations return Promises; evaluation pipelines are fully async

The system enables fair comparison of RAG retrieval pipelines through standardized evaluation against LangSmith-stored ground truth datasets.

---

## Senior Engineer Review Notes

> Reviewed 2026-01-30. These notes identify gaps, bugs, ambiguities, and improvements needed before implementation begins.

### Critical Bugs to Fix During Implementation

1. **Chunk-Level Generator `_buildChunkIndex` loses document association.** The `_chunkIndex` maps `chunkId -> content` but never records which document produced each chunk. Then `_generateQAPairs` always takes `.slice(0, 20)` of the full map instead of filtering to the current document's chunks. Fix: store `Map<string, { content: string; docId: DocumentId }>` and filter per-document inside the loop.

2. **Chunk-Level Evaluation creates fake `PositionAwareChunk` with `docId: "unknown"` and `start: 0`.** This is a lossy conversion that breaks any vector store relying on metadata. The `_chunkCorpus` method should track the source document per chunk and produce proper position-aware chunks (or the VectorStore interface should accept plain `Chunk` for chunk-level eval -- see architectural note below).

3. **Chunk ID round-tripping via string replace is fragile.** `String(c.id).replace("pa_chunk_", "chunk_")` assumes the prefix appears exactly once and at the start. Use a dedicated mapping or store the original `ChunkId` in metadata instead of string manipulation.

4. **`_fuzzyFind` is a stub returning `-1`.** This means any LLM excerpt that is even slightly paraphrased silently produces no spans. Either implement a real sliding-window Levenshtein/Jaro-Winkler match, or at minimum do case-insensitive and whitespace-normalized search as a fallback before giving up.

5. **`mergeOverlappingSpans` sets `text: ""` on merged spans.** This breaks the `CharacterSpanSchema` validation which requires `text.length === end - start`. Either remove that Zod refinement for internal computation spans, or introduce an `InternalSpan` type without the text field for metric calculations. Recommended: create a `SpanRange` type `{ docId, start, end }` for metric internals, keep `CharacterSpan` (with text) for API boundaries only.

6. **OpenAI Embedder uses `require()` in an ESM project.** The project is `"type": "module"`. `require()` will fail at runtime. Use dynamic `await import("openai")` instead. Same issue in `ChromaVectorStore`, `CohereReranker`, and `langsmith/client.ts`.

### Architectural Improvements

7. **VectorStore interface forces `PositionAwareChunk` everywhere.** Chunk-level evaluation does not need position awareness. Consider a generic `VectorStore<T>` or have the chunk-level path use a simpler `ChunkVectorStore` interface that accepts `Chunk`. This avoids the fake position data hack in `ChunkLevelEvaluation`.

8. **No cleanup of vector store after evaluation.** Both evaluation classes create/populate a vector store but never call `clear()`. Add cleanup in a `finally` block or use a disposable pattern (`Symbol.dispose` / `using` if targeting Node 20+).

9. **No batching for embeddings.** `embedder.embed(chunkTexts)` sends all chunks in one call. OpenAI has a token limit per request. Add a `batchSize` option (default 100) and batch the calls. Same concern for `vectorStore.add()` -- Chroma has batch limits.

10. **No rate limiting or retry logic.** LLM calls in synthetic data generation, embedding calls, and reranking calls can all fail transiently. Add a simple retry utility with exponential backoff. Consider `p-retry` or a minimal custom implementation.

11. **Hardcoded `model: "gpt-4"` in `SyntheticDatasetGenerator.callLLM`.** The model should be configurable via constructor options, defaulting to `"gpt-4o"` (newer, cheaper, faster). Add a `model` field to `LLMClient` options or the generator constructor.

12. **No progress reporting.** Generating synthetic data and running evaluations can take minutes. Add an optional `onProgress?: (event: ProgressEvent) => void` callback to `GenerateOptions` and `RunOptions`.

### Missing Pieces for Implementation

13. **ESLint config is `.eslintrc.cjs` but ESLint 9 uses flat config (`eslint.config.mjs`).** The plan specifies `eslint: "^9.0"` with `@typescript-eslint/eslint-plugin: "^7.0"`. ESLint 9 dropped `.eslintrc` support. Use `eslint.config.mjs` with `typescript-eslint` v8+ flat config. Update devDependencies:
    ```json
    "eslint": "^9.0",
    "typescript-eslint": "^8.0",
    ```
    Remove `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` (merged into `typescript-eslint` in v8).

14. **No `.env` handling.** OpenAI, Cohere, LangSmith all need API keys. Document required env vars (`OPENAI_API_KEY`, `COHERE_API_KEY`, `LANGCHAIN_API_KEY`) and add `dotenv` as an optional dependency or document that users handle env themselves.

15. **No logging abstraction.** Code uses `console.warn` directly. Add a minimal logger interface so consumers can plug in their own (pino, winston, etc.) or silence warnings in tests:
    ```typescript
    interface Logger {
      warn(message: string): void;
      info(message: string): void;
      debug(message: string): void;
    }
    ```

16. **`corpusFromFolder` is unimplemented.** This is the primary entry point for users. Provide the implementation using `node:fs/promises` `readdir` with recursive option (Node 18.17+). Do not use `glob` from `node:fs/promises` (that is Node 22+ only). Use `fast-glob` as a dependency or simple recursive readdir.

17. **No subpath exports in `package.json`.** The plan mentions optional implementations imported via `"rag-evaluation-system/embedders/openai"` but the `exports` field only has `"."`. Add:
    ```json
    "exports": {
      ".": { "import": "./dist/index.js", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" },
      "./embedders/openai": { "import": "./dist/embedders/openai.js", "types": "./dist/embedders/openai.d.ts" },
      "./vector-stores/chroma": { "import": "./dist/vector-stores/chroma.js", "types": "./dist/vector-stores/chroma.d.ts" },
      "./rerankers/cohere": { "import": "./dist/rerankers/cohere.js", "types": "./dist/rerankers/cohere.d.ts" }
    }
    ```
    And update `tsup.config.ts` to have multiple entry points.

18. **`tsconfig.json` paths alias `@/*` requires tsup path resolution.** tsup does not resolve TypeScript path aliases by default. Either remove the alias and use relative imports, or add `tsup-plugin-resolve-alias` / configure esbuild aliases in `tsup.config.ts`.

19. **Missing `Zod` schemas for ground truth and results.** Only `DocumentSchema`, `CorpusSchema`, and `CharacterSpanSchema` are defined. Add schemas for `ChunkLevelDatasetExample` and `TokenLevelDatasetExample` to validate data loaded from LangSmith.

### Testing Gaps

20. **No tests for LangSmith integration.** Add unit tests with a mock LangSmith client (inject via constructor or module mock). Test upload serialization and load deserialization round-trips.

21. **No tests for the evaluation orchestrators.** These are the most complex classes. Add integration tests with in-memory vector store mock, mock embedder, and fixture ground truth data -- no real API calls needed.

22. **Add an `InMemoryVectorStore` for testing.** Brute-force cosine similarity. This eliminates the Chroma dependency from the test suite and makes CI simpler:
    ```typescript
    export class InMemoryVectorStore implements VectorStore {
      readonly name = "InMemory";
      private _chunks: PositionAwareChunk[] = [];
      private _embeddings: number[][] = [];

      async add(chunks: PositionAwareChunk[], embeddings: number[][]): Promise<void> {
        this._chunks.push(...chunks);
        this._embeddings.push(...embeddings);
      }

      async search(queryEmbedding: number[], k = 5): Promise<PositionAwareChunk[]> {
        const scored = this._chunks.map((chunk, i) => ({
          chunk,
          score: cosineSimilarity(queryEmbedding, this._embeddings[i]),
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k).map((s) => s.chunk);
      }

      async clear(): Promise<void> {
        this._chunks = [];
        this._embeddings = [];
      }
    }
    ```

23. **Test fixture `sampleSpans` has `"x".repeat(50)` text that does not match actual document content.** This is fine for metric math tests but could mask bugs. Add fixtures with realistic text and matching positions.

### Phase Order Optimization

24. **Recommended adjusted phase order for fastest path to testable code:**
    - Phase 1: Project setup (unchanged)
    - Phase 2: Core types + utils/hashing + utils/span (merge utils into this phase)
    - Phase 3: Metrics (pure functions, no dependencies, fully testable immediately)
    - Phase 4: Chunkers + adapter
    - Phase 5: Embedder/VectorStore interfaces + InMemoryVectorStore (test utility)
    - Phase 6: Evaluation orchestrators (now testable with mocks and in-memory store)
    - Phase 7: Synthetic data generation (needs LLM mocking)
    - Phase 8: LangSmith integration
    - Phase 9: Built-in implementations (OpenAI, Chroma, Cohere)
    - Phase 10: Package exports + publishing

    This front-loads pure logic and defers external dependencies, enabling continuous integration testing from Phase 2 onward.

### Minor Issues

25. **`ChunkRecall` returns `0.0` when ground truth is empty.** This is semantically wrong -- if there is nothing to recall, recall is trivially 1.0 (or undefined). Same for `SpanRecall`. Document the chosen convention explicitly.

26. **Duplicate `getClient()` function** in `langsmith/client.ts` and `langsmith/upload.ts`. Extract to a shared `langsmith/get-client.ts` module.

27. **`vitest.config.ts` uses `__dirname`** which is not available in ESM. Use `import.meta.dirname` (Node 21.2+) or `fileURLToPath(import.meta.url)` for Node 18 compatibility.

28. **No `.gitignore` content specified.** Add at minimum: `node_modules/`, `dist/`, `coverage/`, `.env`, `*.tgz`.

29. **Consider adding `CLAUDE.md`** with project conventions, architecture decisions, and quick-start instructions for AI-assisted development. The file is listed in the project structure but not specified.
