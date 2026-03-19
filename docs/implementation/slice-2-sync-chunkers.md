# Slice 2 — Sync Chunkers

> Adds 3 new chunkers (Sentence, Token, Markdown) to the pipeline retriever system, expanding the chunking dimension of the experiment grid. All maintain the **position invariant** required for span-based evaluation.

---

## Architecture Overview

```
                   +----------------------------+
                   |     Chunker Interface      |
                   |  name, chunk(text)         |
                   +-------------+--------------+
                                 |
                   +-------------+--------------+
                   | PositionAwareChunker Iface |
                   | name, chunkWithPositions() |
                   +-------------+--------------+
                                 |
         +-----------+-----------+-----------+-----------+
         |           |                       |           |
  +------+-------+  +--------+------+  +----+-------+  +--------+------+
  | Recursive    |  |   Sentence   |  |   Token    |  |   Markdown   |
  | Character    |  |   Chunker    |  |  Chunker   |  |   Chunker    |
  | (existing)   |  |   (new)      |  |   (new)    |  |    (new)     |
  +--------------+  +--------------+  +------------+  +--------------+
   Split by char     Split by         Split by BPE     Split by header
   separators        sentence         tokens           then sub-split
                     boundaries       (js-tiktoken)    (uses Recursive
                                                        internally)
```

---

## Position Invariant

Every chunker guarantees this invariant, which is critical for span-based evaluation:

```
  doc.content:  "The quick brown fox jumps over the lazy dog."
                 ^                   ^
                 |                   |
              start=0            end=19

  chunk.content = doc.content.slice(chunk.start, chunk.end)
                = "The quick brown fox"

  INVARIANT:  doc.content.slice(start, end) === chunk.content    // always true
```

All three new chunkers enforce this in their tests.

---

## SentenceChunker

**File:** `packages/eval-lib/src/chunkers/sentence.ts`

Splits text at sentence boundaries, groups sentences into chunks that fit within `maxChunkSize`.

```
Options:
  maxChunkSize      default: 1000    (max chars per chunk)
  overlapSentences  default: 0       (sentences carried to next chunk)

Name format: "Sentence(size=1000)"
```

### Splitting Algorithm

```
Input: "First sentence here. Second sentence here. Third sentence here."
                          ^                     ^
                       split                  split
                    (. + space + uppercase)

Step 1: Detect boundaries with regex /(?<=[.!?])\s+(?=[A-Z])/

Step 2: Group sentences until maxChunkSize exceeded:

  maxChunkSize = 30
  +--------------------------+     +--------------------------+
  | "First sentence here."   |     | "Third sentence here."   |
  | "Second sentence here."  |     |                          |
  | (28 chars combined span) |     | (22 chars)               |
  +--------------------------+     +--------------------------+
        Chunk 1                          Chunk 2

Step 3: With overlapSentences=1, last sentence carries forward:

  +----------------------------+   +----------------------------+
  | "First sentence here."     |   | "Second sentence here."    |
  | "Second sentence here."    |   | "Third sentence here."     |
  +----------------------------+   +----------------------------+
        Chunk 1                          Chunk 2
                          overlap ----^
```

### Data Flow

```
chunkWithPositions(doc)
  |
  +--> _splitSentences(text)       --> [{text, start, end}, ...]
  |     regex: /(?<=[.!?])\s+(?=[A-Z])/
  |     tracks char positions via indexOf
  |
  +--> group sentences into chunks
  |     while (groupLen + nextSentence <= maxChunkSize)
  |
  +--> _emitGroup(doc, sentences)  --> PositionAwareChunk
        content = doc.content.slice(start, end)
        id = generatePaChunkId(content, docId, start)
```

---

## TokenChunker

**File:** `packages/eval-lib/src/chunkers/token.ts`

Splits text by BPE token count using `js-tiktoken`, with accurate character-level position tracking.

```
Options:
  maxTokens      default: 256        (max tokens per chunk)
  overlapTokens  default: 0          (tokens carried to next chunk)
  encoding       default: cl100k_base (tiktoken encoding)

Name format: "Token(tokens=256)"

Dependency: js-tiktoken (pure JS BPE tokenizer)
```

### Token-to-Character Mapping

The key challenge is mapping token boundaries back to character positions:

```
Text:    "The quick brown fox"
Tokens:  [The] [_quick] [_brown] [_fox]
          t0     t1       t2      t3

Character offset array (cumulative):
  charOffsets = [0, 3, 9, 15, 19]
                 ^  ^  ^   ^   ^
                 |  |  |   |   |
               t0  t1 t2  t3  end

Fast path: sum decoded token lengths
Fallback:  prefix-decode for multi-byte safety

Roundtrip check:
  if (sum of decoded lengths == original text length)
    use fast path      // O(n)
  else
    use prefix decode  // O(n^2) but correct for multi-byte
```

### Sliding Window

```
maxTokens=4, overlapTokens=1, step = 4-1 = 3

Tokens: [t0] [t1] [t2] [t3] [t4] [t5] [t6] [t7]

Window 1:  [t0  t1  t2  t3]
                         |--- overlap
Window 2:           [t3  t4  t5  t6]
                              |--- overlap
Window 3:                [t6  t7]

Each window --> charOffsets[i] to charOffsets[i+maxTokens]
             --> doc.content.slice(charStart, charEnd)
             --> trim whitespace, adjust start
```

### Validation

Constructor throws if `overlapTokens >= maxTokens` (would cause infinite loop).

---

## MarkdownChunker

**File:** `packages/eval-lib/src/chunkers/markdown.ts`

Splits at markdown header boundaries, merges small sections, and sub-splits large sections using `RecursiveCharacterChunker`.

```
Options:
  maxChunkSize       default: 1000     (max chars per chunk)
  headerLevels       default: [1,2,3]  (which # levels to split on)
  mergeSmallSections default: true     (merge adjacent small sections)

Name format: "Markdown(size=1000)"
```

### Three-Phase Pipeline

```
Phase 1: Split at Headers
+----------------------------------------------------------------+
|  "# Title\n\nIntro.\n\n## Sec 1\n\nContent 1.\n\n## Sec 2..."  |
+----------------------------------------------------------------+
         |              |                    |
         v              v                    v
   +-----------+  +------------+  +------------+
   | # Title   |  | ## Sec 1   |  | ## Sec 2   |
   | Intro.    |  | Content 1. |  | ...        |
   +-----------+  +------------+  +------------+


Phase 2: Merge Small Sections (if enabled)
   +-----------+  +------------+            +-----------------------+
   | Section A |  | Section B  |    --->    | Section A + B         |
   | (30 chars)|  | (25 chars) |            | (combined <= maxSize) |
   +-----------+  +------------+            +-----------------------+
      merge if combined span <= maxChunkSize


Phase 3: Sub-Split Large Sections
   +-------------------------------------------+
   | ## Big Section                             |
   | Very long content that exceeds maxChunkSize|
   | ............................................|
   +-------------------------------------------+
                      |
                      v  (RecursiveCharacterChunker)
   +------------------+  +------------------+
   | Sub-chunk 1      |  | Sub-chunk 2      |
   | (offset-adjusted)|  | (offset-adjusted)|
   +------------------+  +------------------+

   Sub-chunk positions adjusted: adjStart = sub.start + section.start
```

### Composition Pattern

The MarkdownChunker does NOT modify `RecursiveCharacterChunker` — it composes with it:

```
MarkdownChunker._subSplit(doc, section):
  |
  +--> Create synthetic doc from section text
  |      subDoc = createDocument({ id: docId, content: sectionText })
  |
  +--> Chunk with RecursiveCharacterChunker
  |      subChunker = new RecursiveCharacterChunker({ chunkSize, overlap: 0 })
  |      subChunks = subChunker.chunkWithPositions(subDoc)
  |
  +--> Adjust offsets back to original document
         adjStart = sub.start + section.start
         adjEnd   = adjStart + sub.content.length
```

---

## File Layout

```
packages/eval-lib/
  src/
    chunkers/
      chunker.interface.ts        # Chunker + PositionAwareChunker (unchanged)
      recursive-character.ts      # RecursiveCharacterChunker (unchanged)
      sentence.ts                 # SentenceChunker (NEW)
      token.ts                    # TokenChunker (NEW)
      markdown.ts                 # MarkdownChunker (NEW)
      index.ts                    # Barrel: all 4 chunkers + types (MODIFIED)
    index.ts                      # Root barrel (MODIFIED)
  tests/unit/
    chunkers/
      sentence.test.ts            # 9 tests (NEW)
      token.test.ts               # 10 tests (NEW)
      markdown.test.ts            # 13 tests (NEW)
  package.json                    # +js-tiktoken dependency (MODIFIED)
```

---

## Export Pattern

Unlike Slice 1 (sub-path only), chunkers are exported from the **root barrel**:

```
// All available from root:
import {
  RecursiveCharacterChunker,   // pre-existing
  SentenceChunker,             // new
  TokenChunker,                // new
  MarkdownChunker,             // new
  isPositionAwareChunker,
} from "rag-evaluation-system";

// Types also from root:
import type {
  Chunker,
  PositionAwareChunker,
  SentenceChunkerOptions,
  TokenChunkerOptions,
  MarkdownChunkerOptions,
} from "rag-evaluation-system";
```

No separate tsup entry points needed — chunkers ship in the main bundle.

---

## Dependencies

```
package.json dependencies:
  js-tiktoken: "^1.0.21"     # Pure JS BPE tokenizer (used by TokenChunker)
                               # NOT the WASM "tiktoken" package
```

---

## Chunker Comparison

```
+--------------------+----------------+--------------+--------------+
| Chunker            | Split Logic    | Best For     | Overhead     |
+--------------------+----------------+--------------+--------------+
| RecursiveCharacter | char separators| General text | Minimal      |
| Sentence           | [.!?] + \s + A| Prose        | Regex only   |
| Token              | BPE tokens     | Token-budget | js-tiktoken  |
| Markdown           | # headers      | Structured   | Recursive    |
|                    | + sub-split    | docs         | composition  |
+--------------------+----------------+--------------+--------------+
```

---

## Test Summary

```
+---------------------------+-------+-------------------------------------------+
| Test File                 | Tests | Key Assertions                            |
+---------------------------+-------+-------------------------------------------+
| chunkers/sentence.test.ts |   9   | Position invariant, maxChunkSize, overlap, |
|                           |       | empty/whitespace, no-boundary text         |
+---------------------------+-------+-------------------------------------------+
| chunkers/token.test.ts    |  10   | Position invariant, maxTokens (re-encode), |
|                           |       | overlap, empty/whitespace, invalid overlap  |
+---------------------------+-------+-------------------------------------------+
| chunkers/markdown.test.ts |  13   | Position invariant, header splitting,      |
|                           |       | merge small, sub-split large, headerLevels,|
|                           |       | preamble before first header               |
+---------------------------+-------+-------------------------------------------+
  Total: 32 new tests, all verifying position invariant + edge cases
```
