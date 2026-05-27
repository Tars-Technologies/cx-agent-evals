import { describe, expect, it } from "vitest"
import type { PositionAwareChunk } from "../../../src/types/index.js"
import {
  createCharacterSpan,
  createCorpus,
  createDocument,
  DocumentId,
  PositionAwareChunkId,
  positionAwareChunkToSpan,
  QueryId,
  QueryText
} from "../../../src/types/index.js"

describe("Branded type factories", () => {
  it("should create DocumentId from string", () => {
    const id = DocumentId("test.md")
    expect(String(id)).toBe("test.md")
  })

  it("should create PositionAwareChunkId from string", () => {
    const id = PositionAwareChunkId("pa_chunk_abc123")
    expect(String(id)).toBe("pa_chunk_abc123")
  })

  it("should create QueryId and QueryText", () => {
    const id = QueryId("q_1")
    const text = QueryText("What is RAG?")
    expect(String(id)).toBe("q_1")
    expect(String(text)).toBe("What is RAG?")
  })
})

describe("createDocument", () => {
  it("should create a document with frozen metadata", () => {
    const doc = createDocument({
      id: "test.md",
      content: "hello world",
      metadata: { source: "test" }
    })
    expect(doc.id).toBe("test.md")
    expect(doc.content).toBe("hello world")
    expect(doc.metadata).toEqual({ source: "test" })
    expect(Object.isFrozen(doc.metadata)).toBe(true)
  })

  it("should default metadata to empty object", () => {
    const doc = createDocument({ id: "test.md", content: "hello" })
    expect(doc.metadata).toEqual({})
  })
})

describe("createCorpus", () => {
  it("should create a corpus with frozen documents array", () => {
    const doc = createDocument({ id: "test.md", content: "hello" })
    const corpus = createCorpus([doc])
    expect(corpus.documents).toHaveLength(1)
    expect(Object.isFrozen(corpus.documents)).toBe(true)
  })
})

describe("createCharacterSpan", () => {
  it("should create a valid span", () => {
    const span = createCharacterSpan({
      docId: "doc1",
      start: 10,
      end: 50,
      text: "x".repeat(40)
    })
    expect(span.start).toBe(10)
    expect(span.end).toBe(50)
    expect(span.text.length).toBe(40)
  })

  it("should reject end <= start", () => {
    expect(() =>
      createCharacterSpan({ docId: "doc1", start: 50, end: 10, text: "x" })
    ).toThrow()
  })

  it("should reject end == start", () => {
    expect(() =>
      createCharacterSpan({ docId: "doc1", start: 10, end: 10, text: "" })
    ).toThrow()
  })

  it("should reject text length mismatch", () => {
    expect(() =>
      createCharacterSpan({
        docId: "doc1",
        start: 0,
        end: 50,
        text: "x".repeat(10)
      })
    ).toThrow()
  })
})

describe("positionAwareChunkToSpan", () => {
  it("should convert chunk to span", () => {
    const chunk: PositionAwareChunk = {
      id: PositionAwareChunkId("pa_chunk_abc"),
      content: "hello world",
      docId: DocumentId("doc.md"),
      start: 10,
      end: 21,
      metadata: {}
    }
    const span = positionAwareChunkToSpan(chunk)
    expect(span.docId).toBe("doc.md")
    expect(span.start).toBe(10)
    expect(span.end).toBe(21)
    expect(span.text).toBe("hello world")
  })
})
