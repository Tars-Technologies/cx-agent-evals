# Slice 2 — Sync Chunkers — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three new chunker implementations (Sentence, Token, Markdown) that implement the existing `Chunker` + `PositionAwareChunker` interfaces, expanding the experiment configuration grid.

**Architecture:** Each chunker follows the established `RecursiveCharacterChunker` pattern — implements both `Chunker` and `PositionAwareChunker`, uses `generatePaChunkId` for deterministic chunk IDs, and maintains the position invariant (`doc.content.slice(chunk.start, chunk.end) === chunk.content`). The Markdown chunker composes with `RecursiveCharacterChunker` for sub-splitting large sections (via synthetic document + offset adjustment — no modifications to existing code).

**Tech Stack:** TypeScript, Vitest, `js-tiktoken` (pure JS BPE tokenizer for the Token chunker — not WASM).

---

## Review Notes (improvements over original spec)

| # | Original Spec Issue | Fix |
|---|---------------------|-----|
| 1 | `createDocument` called with `DocumentId("d1")` | `createDocument({ id: "d1", ... })` — factory handles branding internally |
| 2 | Chunkers implement only `PositionAwareChunker` | Must implement BOTH `Chunker` and `PositionAwareChunker` (existing pattern) |
| 3 | Markdown sub-split: recommends option (a) — extract public method from `RecursiveCharacterChunker` | Use option (c) instead — compose via synthetic document + offset adjustment. Original claim that (c) "loses position offset" is wrong: offsets ARE adjustable. This avoids modifying existing code. |
| 4 | `js-tiktoken` described as "wasm-based" | It's a pure JS port. The WASM version is the `tiktoken` package. |
| 5 | Sentence regex claims "abbreviation handling" but doesn't specify | Keep simple: `/(?<=[.!?])\s+(?=[A-Z])/` without abbreviation handling. Sufficient for eval use case. |
| 6 | Token chunker doesn't specify char↔token offset mapping algorithm | Added: cumulative per-token decode length array with safe fallback for multi-byte edge cases |
| 7 | Test example is a skeleton | Full test suites with position invariant, size limits, overlap, edge cases, `chunk()` method, and `isPositionAwareChunker` guard |

---

## Ground Truth: Key Files & Interfaces

**Interfaces to implement** (`src/chunkers/chunker.interface.ts`):
```typescript
interface Chunker {
  readonly name: string;
  chunk(text: string): string[];
}

interface PositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): PositionAwareChunk[];
}
```

**Output type** (`src/types/chunks.ts:33-40`):
```typescript
interface PositionAwareChunk {
  readonly id: PositionAwareChunkId;  // "pa_chunk_<16-hex>"
  readonly content: string;
  readonly docId: DocumentId;
  readonly start: number;             // char offset in doc.content
  readonly end: number;               // char offset in doc.content
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

**Critical invariant** (asserted in all tests):
```typescript
doc.content.slice(chunk.start, chunk.end) === chunk.content
```

**Chunk ID generation** (`src/utils/hashing.ts`):
```typescript
generatePaChunkId(content: string, docId?: string, start?: number): PositionAwareChunkId
// Input: `${docId}:${start}:${content}` → SHA-256 → first 16 hex chars → "pa_chunk_<hash>"
```

**Import patterns** (follow existing `recursive-character.ts`):
```typescript
import type { Document, PositionAwareChunk } from "../types/index.js";
import { generatePaChunkId } from "../utils/hashing.js";
import type { Chunker, PositionAwareChunker } from "./chunker.interface.js";
```

**Test import pattern** (follow existing `chunkers.test.ts`):
```typescript
import { describe, it, expect } from "vitest";
import { SomeChunker } from "../../../src/chunkers/some.js";
import { isPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { createDocument } from "../../../src/types/documents.js";
```

---

## Task 1: SentenceChunker

**Files:**
- Create: `packages/eval-lib/src/chunkers/sentence.ts`
- Test: `packages/eval-lib/tests/unit/chunkers/sentence.test.ts`

### Step 1: Write the failing test

Create `packages/eval-lib/tests/unit/chunkers/sentence.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SentenceChunker } from "../../../src/chunkers/sentence.js";
import { isPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { createDocument } from "../../../src/types/documents.js";

describe("SentenceChunker", () => {
  it("should satisfy isPositionAwareChunker", () => {
    const chunker = new SentenceChunker();
    expect(isPositionAwareChunker(chunker)).toBe(true);
  });

  it("should produce valid positions matching source text", () => {
    const content =
      "First sentence here. Second sentence here. Third sentence here.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 50 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should not exceed maxChunkSize", () => {
    const content =
      "Alpha sentence here. Beta sentence here. Gamma sentence here. Delta sentence here. Epsilon sentence here.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 50 });
    const chunks = chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(50);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should return single chunk for short text", () => {
    const content = "Just one sentence.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 1000 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Just one sentence.");
  });

  it("should handle overlap sentences", () => {
    const content =
      "First sent. Second sent. Third sent. Fourth sent.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 30, overlapSentences: 1 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should return empty array for empty text", () => {
    const doc = createDocument({ id: "d1", content: "" });
    const chunker = new SentenceChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should return empty array for whitespace-only text", () => {
    const doc = createDocument({ id: "d1", content: "   \n\n  " });
    const chunker = new SentenceChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should handle text without sentence boundaries", () => {
    const content = "no uppercase after period. still going on";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 1000 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(content);
  });

  it("should implement chunk() for Chunker interface", () => {
    const chunker = new SentenceChunker({ maxChunkSize: 50 });
    const chunks = chunker.chunk(
      "First sentence here. Second sentence here. Third sentence here.",
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(typeof c).toBe("string");
    }
  });

  it("should have a descriptive name", () => {
    const chunker = new SentenceChunker({ maxChunkSize: 500 });
    expect(chunker.name).toBe("Sentence(size=500)");
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/sentence.test.ts`
Expected: FAIL — `Cannot find module '../../../src/chunkers/sentence.js'`

### Step 3: Write the implementation

Create `packages/eval-lib/src/chunkers/sentence.ts`:

```typescript
import type { Document, PositionAwareChunk } from "../types/index.js";
import { generatePaChunkId } from "../utils/hashing.js";
import { createDocument } from "../types/documents.js";
import type { Chunker, PositionAwareChunker } from "./chunker.interface.js";

export interface SentenceChunkerOptions {
  maxChunkSize?: number;
  overlapSentences?: number;
}

export class SentenceChunker implements Chunker, PositionAwareChunker {
  readonly name: string;
  private readonly _maxChunkSize: number;
  private readonly _overlapSentences: number;

  constructor(options: SentenceChunkerOptions = {}) {
    this._maxChunkSize = options.maxChunkSize ?? 1000;
    this._overlapSentences = options.overlapSentences ?? 0;
    this.name = `Sentence(size=${this._maxChunkSize})`;
  }

  chunk(text: string): string[] {
    const doc = createDocument({ id: "_chunk_", content: text });
    return this.chunkWithPositions(doc).map((c) => c.content);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    if (doc.content.trim().length === 0) return [];

    const sentences = this._splitSentences(doc.content);
    if (sentences.length === 0) return [];

    const results: PositionAwareChunk[] = [];
    let group: Array<{ text: string; start: number; end: number }> = [];

    for (const sentence of sentences) {
      const groupStart = group.length > 0 ? group[0].start : sentence.start;
      const potentialLen = sentence.end - groupStart;

      if (potentialLen > this._maxChunkSize && group.length > 0) {
        this._emitGroup(doc, group, results);

        if (this._overlapSentences > 0) {
          group = group.slice(-this._overlapSentences);
        } else {
          group = [];
        }
      }

      group.push(sentence);
    }

    if (group.length > 0) {
      this._emitGroup(doc, group, results);
    }

    return results;
  }

  private _emitGroup(
    doc: Document,
    sentences: Array<{ text: string; start: number; end: number }>,
    results: PositionAwareChunk[],
  ): void {
    const start = sentences[0].start;
    const end = sentences[sentences.length - 1].end;
    const content = doc.content.slice(start, end);

    results.push({
      id: generatePaChunkId(content, String(doc.id), start),
      content,
      docId: doc.id,
      start,
      end,
      metadata: {},
    });
  }

  /**
   * Split text into sentences at boundaries: [.!?] followed by whitespace + uppercase letter.
   * Returns sentences with their character offsets in the original text.
   */
  private _splitSentences(
    text: string,
  ): Array<{ text: string; start: number; end: number }> {
    if (text.trim().length === 0) return [];

    // Split after sentence-ending punctuation followed by whitespace and uppercase
    const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const result: Array<{ text: string; start: number; end: number }> = [];
    let searchFrom = 0;

    for (const part of parts) {
      if (part.trim().length === 0) continue;
      const idx = text.indexOf(part, searchFrom);
      if (idx === -1) continue;
      result.push({ text: part, start: idx, end: idx + part.length });
      searchFrom = idx + part.length;
    }

    return result;
  }
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/sentence.test.ts`
Expected: All 9 tests PASS

### Step 5: Commit

```bash
git add packages/eval-lib/src/chunkers/sentence.ts packages/eval-lib/tests/unit/chunkers/sentence.test.ts
git commit -m "feat(eval-lib): add SentenceChunker with position-aware sentence splitting"
```

---

## Task 2: TokenChunker

**Files:**
- Create: `packages/eval-lib/src/chunkers/token.ts`
- Test: `packages/eval-lib/tests/unit/chunkers/token.test.ts`
- Modify: `packages/eval-lib/package.json` (add `js-tiktoken` dependency)

### Step 1: Install js-tiktoken

Run: `pnpm -C packages/eval-lib add js-tiktoken`

Verify in `packages/eval-lib/package.json` that `"js-tiktoken"` appears in `dependencies`.

### Step 2: Commit dependency

```bash
git add packages/eval-lib/package.json pnpm-lock.yaml
git commit -m "build(eval-lib): add js-tiktoken dependency for TokenChunker"
```

### Step 3: Write the failing test

Create `packages/eval-lib/tests/unit/chunkers/token.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { TokenChunker } from "../../../src/chunkers/token.js";
import { isPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { createDocument } from "../../../src/types/documents.js";
import { getEncoding } from "js-tiktoken";

describe("TokenChunker", () => {
  it("should satisfy isPositionAwareChunker", () => {
    const chunker = new TokenChunker();
    expect(isPositionAwareChunker(chunker)).toBe(true);
  });

  it("should produce valid positions matching source text", () => {
    const content =
      "The quick brown fox jumps over the lazy dog. A second sentence follows here with some additional words for testing purposes.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new TokenChunker({ maxTokens: 10 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should not exceed maxTokens per chunk", () => {
    const content =
      "The quick brown fox jumps over the lazy dog. A second sentence follows here with some additional words.";
    const doc = createDocument({ id: "d1", content });
    const maxTokens = 10;
    const chunker = new TokenChunker({ maxTokens });
    const chunks = chunker.chunkWithPositions(doc);

    const enc = getEncoding("cl100k_base");
    for (const chunk of chunks) {
      const tokenCount = enc.encode(chunk.content).length;
      expect(tokenCount).toBeLessThanOrEqual(maxTokens);
    }
  });

  it("should return single chunk for short text", () => {
    const content = "Hello world.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new TokenChunker({ maxTokens: 256 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Hello world.");
  });

  it("should handle token overlap", () => {
    const content =
      "Word1 Word2 Word3 Word4 Word5 Word6 Word7 Word8 Word9 Word10 Word11 Word12";
    const doc = createDocument({ id: "d1", content });
    const chunker = new TokenChunker({ maxTokens: 6, overlapTokens: 2 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should return empty array for empty text", () => {
    const doc = createDocument({ id: "d1", content: "" });
    const chunker = new TokenChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should return empty array for whitespace-only text", () => {
    const doc = createDocument({ id: "d1", content: "   \n\n  " });
    const chunker = new TokenChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should implement chunk() for Chunker interface", () => {
    const chunker = new TokenChunker({ maxTokens: 10 });
    const chunks = chunker.chunk(
      "The quick brown fox jumps over the lazy dog.",
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(typeof c).toBe("string");
    }
  });

  it("should reject overlapTokens >= maxTokens", () => {
    expect(
      () => new TokenChunker({ maxTokens: 10, overlapTokens: 10 }),
    ).toThrow();
    expect(
      () => new TokenChunker({ maxTokens: 10, overlapTokens: 15 }),
    ).toThrow();
  });

  it("should have a descriptive name", () => {
    const chunker = new TokenChunker({ maxTokens: 128 });
    expect(chunker.name).toBe("Token(tokens=128)");
  });
});
```

### Step 4: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/token.test.ts`
Expected: FAIL — `Cannot find module '../../../src/chunkers/token.js'`

### Step 5: Write the implementation

Create `packages/eval-lib/src/chunkers/token.ts`:

```typescript
import type { Document, PositionAwareChunk } from "../types/index.js";
import { generatePaChunkId } from "../utils/hashing.js";
import { createDocument } from "../types/documents.js";
import type { Chunker, PositionAwareChunker } from "./chunker.interface.js";
import { getEncoding } from "js-tiktoken";
import type { Tiktoken } from "js-tiktoken";

export interface TokenChunkerOptions {
  maxTokens?: number;
  overlapTokens?: number;
  encoding?: string;
}

export class TokenChunker implements Chunker, PositionAwareChunker {
  readonly name: string;
  private readonly _maxTokens: number;
  private readonly _overlapTokens: number;
  private readonly _encoding: string;

  constructor(options: TokenChunkerOptions = {}) {
    this._maxTokens = options.maxTokens ?? 256;
    this._overlapTokens = options.overlapTokens ?? 0;
    this._encoding = options.encoding ?? "cl100k_base";

    if (this._overlapTokens >= this._maxTokens) {
      throw new Error("overlapTokens must be less than maxTokens");
    }

    this.name = `Token(tokens=${this._maxTokens})`;
  }

  chunk(text: string): string[] {
    const doc = createDocument({ id: "_chunk_", content: text });
    return this.chunkWithPositions(doc).map((c) => c.content);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    if (doc.content.trim().length === 0) return [];

    const enc = getEncoding(this._encoding as Parameters<typeof getEncoding>[0]);
    const tokens = enc.encode(doc.content);

    if (tokens.length === 0) return [];

    const charOffsets = this._buildCharOffsets(enc, tokens, doc.content);
    const step = this._maxTokens - this._overlapTokens;
    const results: PositionAwareChunk[] = [];

    for (let i = 0; i < tokens.length; i += step) {
      const end = Math.min(i + this._maxTokens, tokens.length);
      const charStart = charOffsets[i];
      const charEnd = charOffsets[end];
      const raw = doc.content.slice(charStart, charEnd);
      const content = raw.trim();

      if (content.length === 0) continue;

      const trimOffset = raw.indexOf(content);
      const adjStart = charStart + trimOffset;

      results.push({
        id: generatePaChunkId(content, String(doc.id), adjStart),
        content,
        docId: doc.id,
        start: adjStart,
        end: adjStart + content.length,
        metadata: {},
      });

      if (end >= tokens.length) break;
    }

    return results;
  }

  /**
   * Build a cumulative character offset array: charOffsets[i] = character
   * position in originalText where token i starts.
   *
   * Uses per-token decode with a roundtrip verification. Falls back to
   * prefix-decode at chunk boundaries for multi-byte character safety.
   */
  private _buildCharOffsets(
    enc: Tiktoken,
    tokens: number[],
    originalText: string,
  ): number[] {
    // Fast path: decode each token individually and sum lengths
    const offsets: number[] = [0];
    let cumLen = 0;

    for (let i = 0; i < tokens.length; i++) {
      const tokenText = enc.decode([tokens[i]]);
      cumLen += tokenText.length;
      offsets.push(cumLen);
    }

    // Verify roundtrip: cumulative length should match original text length
    if (cumLen === originalText.length) {
      return offsets;
    }

    // Slow fallback: decode prefixes for accuracy with multi-byte chars
    const safeOffsets: number[] = [0];
    for (let i = 1; i <= tokens.length; i++) {
      safeOffsets.push(enc.decode(tokens.slice(0, i)).length);
    }
    return safeOffsets;
  }
}
```

### Step 6: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/token.test.ts`
Expected: All 10 tests PASS

### Step 7: Commit

```bash
git add packages/eval-lib/src/chunkers/token.ts packages/eval-lib/tests/unit/chunkers/token.test.ts
git commit -m "feat(eval-lib): add TokenChunker with js-tiktoken BPE tokenization"
```

---

## Task 3: MarkdownChunker

**Files:**
- Create: `packages/eval-lib/src/chunkers/markdown.ts`
- Test: `packages/eval-lib/tests/unit/chunkers/markdown.test.ts`

**Design decision:** When a section exceeds `maxChunkSize`, sub-split by composing with `RecursiveCharacterChunker`. Create a synthetic `Document` from the section text, call `chunkWithPositions()`, then adjust all `start`/`end` offsets by adding the section's base offset. This avoids modifying existing code and preserves the position invariant.

### Step 1: Write the failing test

Create `packages/eval-lib/tests/unit/chunkers/markdown.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { MarkdownChunker } from "../../../src/chunkers/markdown.js";
import { isPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { createDocument } from "../../../src/types/documents.js";

describe("MarkdownChunker", () => {
  it("should satisfy isPositionAwareChunker", () => {
    const chunker = new MarkdownChunker();
    expect(isPositionAwareChunker(chunker)).toBe(true);
  });

  it("should produce valid positions matching source text", () => {
    const content =
      "# Title\n\nSome intro text.\n\n## Section 1\n\nContent of section one.\n\n## Section 2\n\nContent of section two.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({ maxChunkSize: 1000 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should split at header boundaries", () => {
    const content =
      "# Header 1\n\nFirst section content.\n\n# Header 2\n\nSecond section content.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 1000,
      mergeSmallSections: false,
    });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toContain("Header 1");
    expect(chunks[1].content).toContain("Header 2");
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should merge small sections when enabled", () => {
    const content = "# A\n\nSmall.\n\n# B\n\nSmall.\n\n# C\n\nSmall.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 200,
      mergeSmallSections: true,
    });
    const chunks = chunker.chunkWithPositions(doc);

    // All sections together are well under 200 chars, should merge into 1
    expect(chunks).toHaveLength(1);
    expect(content.slice(chunks[0].start, chunks[0].end)).toBe(
      chunks[0].content,
    );
  });

  it("should not merge sections that exceed maxChunkSize", () => {
    const longContent = "Some detailed content here. ".repeat(5);
    const content = `# Section A\n\n${longContent}\n\n# Section B\n\n${longContent}`;
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 100,
      mergeSmallSections: true,
    });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should sub-split large sections", () => {
    const longContent = "Detailed content. ".repeat(100);
    const content = `# Section\n\n${longContent.trim()}`;
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({ maxChunkSize: 200 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(200);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should handle text with no headers", () => {
    const content = "Just plain text without any markdown headers.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({ maxChunkSize: 1000 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(content);
  });

  it("should return empty array for empty text", () => {
    const doc = createDocument({ id: "d1", content: "" });
    const chunker = new MarkdownChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should return empty array for whitespace-only text", () => {
    const doc = createDocument({ id: "d1", content: "   \n\n  " });
    const chunker = new MarkdownChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should respect headerLevels option", () => {
    const content =
      "# H1\n\nH1 content.\n\n## H2\n\nH2 content.\n\n### H3\n\nH3 content.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 1000,
      headerLevels: [1],
      mergeSmallSections: false,
    });
    const chunks = chunker.chunkWithPositions(doc);

    // Only H1 is a split point, so everything is one section
    expect(chunks).toHaveLength(1);
    expect(content.slice(chunks[0].start, chunks[0].end)).toBe(
      chunks[0].content,
    );
  });

  it("should handle content before first header", () => {
    const content = "Preamble text.\n\n# Header\n\nSection content.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 1000,
      mergeSmallSections: false,
    });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toBe("Preamble text.");
    expect(chunks[1].content).toContain("Header");
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should implement chunk() for Chunker interface", () => {
    const chunker = new MarkdownChunker({ maxChunkSize: 100 });
    const chunks = chunker.chunk(
      "# Title\n\nContent here.\n\n## Section\n\nMore content.",
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(typeof c).toBe("string");
    }
  });

  it("should have a descriptive name", () => {
    const chunker = new MarkdownChunker({ maxChunkSize: 500 });
    expect(chunker.name).toBe("Markdown(size=500)");
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/markdown.test.ts`
Expected: FAIL — `Cannot find module '../../../src/chunkers/markdown.js'`

### Step 3: Write the implementation

Create `packages/eval-lib/src/chunkers/markdown.ts`:

```typescript
import type { Document, PositionAwareChunk } from "../types/index.js";
import { generatePaChunkId } from "../utils/hashing.js";
import { createDocument } from "../types/documents.js";
import type { Chunker, PositionAwareChunker } from "./chunker.interface.js";
import { RecursiveCharacterChunker } from "./recursive-character.js";

export interface MarkdownChunkerOptions {
  maxChunkSize?: number;
  headerLevels?: number[];
  mergeSmallSections?: boolean;
}

export class MarkdownChunker implements Chunker, PositionAwareChunker {
  readonly name: string;
  private readonly _maxChunkSize: number;
  private readonly _headerLevels: Set<number>;
  private readonly _mergeSmallSections: boolean;

  constructor(options: MarkdownChunkerOptions = {}) {
    this._maxChunkSize = options.maxChunkSize ?? 1000;
    this._headerLevels = new Set(options.headerLevels ?? [1, 2, 3]);
    this._mergeSmallSections = options.mergeSmallSections ?? true;
    this.name = `Markdown(size=${this._maxChunkSize})`;
  }

  chunk(text: string): string[] {
    const doc = createDocument({ id: "_chunk_", content: text });
    return this.chunkWithPositions(doc).map((c) => c.content);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    if (doc.content.trim().length === 0) return [];

    const sections = this._splitAtHeaders(doc.content);
    if (sections.length === 0) return [];

    const merged = this._mergeSmallSections
      ? this._merge(sections)
      : sections;

    const results: PositionAwareChunk[] = [];

    for (const section of merged) {
      const sectionLen = section.end - section.start;

      if (sectionLen <= this._maxChunkSize) {
        const content = doc.content.slice(section.start, section.end);
        results.push({
          id: generatePaChunkId(content, String(doc.id), section.start),
          content,
          docId: doc.id,
          start: section.start,
          end: section.end,
          metadata: {},
        });
      } else {
        // Sub-split large sections via RecursiveCharacterChunker
        this._subSplit(doc, section, results);
      }
    }

    return results;
  }

  /**
   * Find header lines matching configured levels and split text into sections.
   * Each section runs from a header to the start of the next header (trimmed).
   * Content before the first header becomes its own section.
   */
  private _splitAtHeaders(
    text: string,
  ): Array<{ start: number; end: number }> {
    const headerPattern = /^(#{1,6})\s+(.+)$/gm;
    const boundaries: number[] = [];

    let match;
    while ((match = headerPattern.exec(text)) !== null) {
      const level = match[1].length;
      if (this._headerLevels.has(level)) {
        boundaries.push(match.index);
      }
    }

    if (boundaries.length === 0) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return [];
      const trimStart = text.indexOf(trimmed);
      return [{ start: trimStart, end: trimStart + trimmed.length }];
    }

    const sections: Array<{ start: number; end: number }> = [];

    // Content before first header (if any)
    if (boundaries[0] > 0) {
      const pre = text.slice(0, boundaries[0]).trim();
      if (pre.length > 0) {
        const trimStart = text.indexOf(pre);
        sections.push({ start: trimStart, end: trimStart + pre.length });
      }
    }

    // Each header section
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      const rawEnd =
        i < boundaries.length - 1 ? boundaries[i + 1] : text.length;
      const sectionText = text.slice(start, rawEnd);
      const trimmed = sectionText.trimEnd();
      if (trimmed.length > 0) {
        sections.push({ start, end: start + trimmed.length });
      }
    }

    return sections;
  }

  /**
   * Merge adjacent sections when their combined span fits within maxChunkSize.
   * Merged content is doc.content.slice(firstStart, lastEnd) — preserves
   * original whitespace between sections.
   */
  private _merge(
    sections: Array<{ start: number; end: number }>,
  ): Array<{ start: number; end: number }> {
    if (sections.length <= 1) return sections;

    const merged: Array<{ start: number; end: number }> = [];
    let currentStart = sections[0].start;
    let currentEnd = sections[0].end;

    for (let i = 1; i < sections.length; i++) {
      const next = sections[i];
      const mergedLen = next.end - currentStart;

      if (mergedLen <= this._maxChunkSize) {
        currentEnd = next.end;
      } else {
        merged.push({ start: currentStart, end: currentEnd });
        currentStart = next.start;
        currentEnd = next.end;
      }
    }

    merged.push({ start: currentStart, end: currentEnd });
    return merged;
  }

  /**
   * Sub-split a large section using RecursiveCharacterChunker, then adjust
   * all chunk positions by the section's base offset.
   */
  private _subSplit(
    doc: Document,
    section: { start: number; end: number },
    results: PositionAwareChunk[],
  ): void {
    const sectionText = doc.content.slice(section.start, section.end);
    const subDoc = createDocument({ id: String(doc.id), content: sectionText });
    const subChunker = new RecursiveCharacterChunker({
      chunkSize: this._maxChunkSize,
      chunkOverlap: 0,
    });
    const subChunks = subChunker.chunkWithPositions(subDoc);

    for (const sub of subChunks) {
      const adjStart = sub.start + section.start;
      results.push({
        id: generatePaChunkId(sub.content, String(doc.id), adjStart),
        content: sub.content,
        docId: doc.id,
        start: adjStart,
        end: adjStart + sub.content.length,
        metadata: {},
      });
    }
  }
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/markdown.test.ts`
Expected: All 13 tests PASS

### Step 5: Commit

```bash
git add packages/eval-lib/src/chunkers/markdown.ts packages/eval-lib/tests/unit/chunkers/markdown.test.ts
git commit -m "feat(eval-lib): add MarkdownChunker with header-aware splitting and sub-split composition"
```

---

## Task 4: Exports & Integration

**Files:**
- Modify: `packages/eval-lib/src/chunkers/index.ts` (add re-exports)
- Modify: `packages/eval-lib/src/index.ts` (add to root barrel)

### Step 1: Update chunkers barrel

Add to `packages/eval-lib/src/chunkers/index.ts` (after existing line 4):

```typescript
export { SentenceChunker } from "./sentence.js";
export type { SentenceChunkerOptions } from "./sentence.js";
export { TokenChunker } from "./token.js";
export type { TokenChunkerOptions } from "./token.js";
export { MarkdownChunker } from "./markdown.js";
export type { MarkdownChunkerOptions } from "./markdown.js";
```

### Step 2: Update root barrel

In `packages/eval-lib/src/index.ts`, update the Chunkers section (lines 37-38):

```typescript
// Chunkers
export type { Chunker, PositionAwareChunker, RecursiveCharacterChunkerOptions, SentenceChunkerOptions, TokenChunkerOptions, MarkdownChunkerOptions } from "./chunkers/index.js";
export { isPositionAwareChunker, RecursiveCharacterChunker, SentenceChunker, TokenChunker, MarkdownChunker } from "./chunkers/index.js";
```

### Step 3: Build and typecheck

Run: `pnpm -C packages/eval-lib build && pnpm -C packages/eval-lib typecheck`
Expected: Both succeed with no errors

### Step 4: Run the full test suite

Run: `pnpm -C packages/eval-lib test`
Expected: All tests pass (existing 225 + new ~32 = ~257 tests)

### Step 5: Commit

```bash
git add packages/eval-lib/src/chunkers/index.ts packages/eval-lib/src/index.ts
git commit -m "feat(eval-lib): export SentenceChunker, TokenChunker, MarkdownChunker from barrel"
```

---

## File Inventory

### New Files
| File | Description |
|------|-------------|
| `packages/eval-lib/src/chunkers/sentence.ts` | SentenceChunker implementation |
| `packages/eval-lib/src/chunkers/token.ts` | TokenChunker implementation |
| `packages/eval-lib/src/chunkers/markdown.ts` | MarkdownChunker implementation |
| `packages/eval-lib/tests/unit/chunkers/sentence.test.ts` | SentenceChunker tests |
| `packages/eval-lib/tests/unit/chunkers/token.test.ts` | TokenChunker tests |
| `packages/eval-lib/tests/unit/chunkers/markdown.test.ts` | MarkdownChunker tests |

### Modified Files
| File | Change |
|------|--------|
| `packages/eval-lib/src/chunkers/index.ts` | Add 6 re-export lines |
| `packages/eval-lib/src/index.ts` | Update 2 lines in Chunkers section |
| `packages/eval-lib/package.json` | Add `js-tiktoken` to dependencies |
| `pnpm-lock.yaml` | Auto-updated by pnpm |

### NOT Modified (design decision)
| File | Why |
|------|-----|
| `packages/eval-lib/src/chunkers/recursive-character.ts` | MarkdownChunker composes with it via synthetic document — no need to extract public methods |
| `packages/eval-lib/tsup.config.ts` | Chunkers are bundled into the root `dist/index.js` via the barrel — no separate entry point needed |
