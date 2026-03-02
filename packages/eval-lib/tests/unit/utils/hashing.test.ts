import { describe, it, expect } from "vitest";
import { generatePaChunkId } from "../../../src/utils/hashing.js";

describe("generatePaChunkId", () => {
  it("should produce deterministic IDs", () => {
    expect(generatePaChunkId("hello world")).toBe(generatePaChunkId("hello world"));
  });

  it("should produce different IDs for different content", () => {
    expect(generatePaChunkId("hello")).not.toBe(generatePaChunkId("world"));
  });

  it("should have pa_chunk_ prefix", () => {
    expect(String(generatePaChunkId("test"))).toMatch(/^pa_chunk_[a-f0-9]{16}$/);
  });

  it("should produce different IDs for same content but different docId", () => {
    const id1 = generatePaChunkId("same content", "doc-1", 0);
    const id2 = generatePaChunkId("same content", "doc-2", 0);
    expect(id1).not.toBe(id2);
  });

  it("should produce different IDs for same content and position but different docId", () => {
    const id1 = generatePaChunkId("same content", "doc-A", 100);
    const id2 = generatePaChunkId("same content", "doc-B", 100);
    expect(id1).not.toBe(id2);
  });

  it("should produce different IDs for same content and docId but different start", () => {
    const id1 = generatePaChunkId("same content", "doc-1", 0);
    const id2 = generatePaChunkId("same content", "doc-1", 500);
    expect(id1).not.toBe(id2);
  });

  it("backward compat: calling with just content still works", () => {
    const id = generatePaChunkId("some text");
    expect(String(id)).toMatch(/^pa_chunk_[a-f0-9]{16}$/);
    // Should be deterministic
    expect(id).toBe(generatePaChunkId("some text"));
  });

  it("should produce deterministic IDs with docId and start", () => {
    const id1 = generatePaChunkId("content", "doc-1", 42);
    const id2 = generatePaChunkId("content", "doc-1", 42);
    expect(id1).toBe(id2);
  });
});
