import { describe, it, expect, vi } from "vitest";
import { CallbackRetriever } from "../../../src/retrievers/callback-retriever.js";
import type { Corpus, PositionAwareChunk } from "../../../src/types/index.js";
import { DocumentId, PositionAwareChunkId } from "../../../src/types/primitives.js";

const corpus: Corpus = {
  documents: [
    { id: DocumentId("doc1"), content: "Hello world", metadata: {} },
  ],
  metadata: {},
};

const sampleChunks: PositionAwareChunk[] = [
  {
    id: PositionAwareChunkId("chunk-1"),
    content: "Hello world",
    docId: DocumentId("doc1"),
    start: 0,
    end: 11,
    metadata: {},
  },
];

describe("CallbackRetriever", () => {
  describe("name", () => {
    it("should set name from config", () => {
      const retriever = new CallbackRetriever({
        name: "my-retriever",
        retrieveFn: vi.fn(),
      });

      expect(retriever.name).toBe("my-retriever");
    });
  });

  describe("init", () => {
    it("should call the provided init callback with the corpus", async () => {
      const initFn = vi.fn().mockResolvedValue(undefined);
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn: vi.fn(),
        initFn,
      });

      await retriever.init(corpus);

      expect(initFn).toHaveBeenCalledOnce();
      expect(initFn).toHaveBeenCalledWith(corpus);
    });

    it("should be a no-op when no init callback is provided", async () => {
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn: vi.fn(),
      });

      // Should not throw
      await expect(retriever.init(corpus)).resolves.toBeUndefined();
    });
  });

  describe("retrieve", () => {
    it("should call the provided retrieve callback and return its results", async () => {
      const retrieveFn = vi.fn().mockResolvedValue(sampleChunks);
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn,
      });

      const results = await retriever.retrieve("test query", 5);

      expect(retrieveFn).toHaveBeenCalledOnce();
      expect(retrieveFn).toHaveBeenCalledWith("test query", 5);
      expect(results).toEqual(sampleChunks);
    });

    it("should return empty array when callback returns empty", async () => {
      const retrieveFn = vi.fn().mockResolvedValue([]);
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn,
      });

      const results = await retriever.retrieve("no matches", 10);

      expect(results).toEqual([]);
    });
  });

  describe("cleanup", () => {
    it("should call the provided cleanup callback", async () => {
      const cleanupFn = vi.fn().mockResolvedValue(undefined);
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn: vi.fn(),
        cleanupFn,
      });

      await retriever.cleanup();

      expect(cleanupFn).toHaveBeenCalledOnce();
    });

    it("should be a no-op when no cleanup callback is provided", async () => {
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn: vi.fn(),
      });

      // Should not throw
      await expect(retriever.cleanup()).resolves.toBeUndefined();
    });
  });

  describe("error propagation", () => {
    it("should propagate errors from initFn", async () => {
      const initFn = vi.fn().mockRejectedValue(new Error("init failed"));
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn: vi.fn(),
        initFn,
      });

      await expect(retriever.init(corpus)).rejects.toThrow("init failed");
    });

    it("should propagate errors from retrieveFn", async () => {
      const retrieveFn = vi
        .fn()
        .mockRejectedValue(new Error("retrieve failed"));
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn,
      });

      await expect(retriever.retrieve("query", 5)).rejects.toThrow(
        "retrieve failed",
      );
    });

    it("should propagate errors from cleanupFn", async () => {
      const cleanupFn = vi
        .fn()
        .mockRejectedValue(new Error("cleanup failed"));
      const retriever = new CallbackRetriever({
        name: "test",
        retrieveFn: vi.fn(),
        cleanupFn,
      });

      await expect(retriever.cleanup()).rejects.toThrow("cleanup failed");
    });
  });
});
