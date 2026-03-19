import { describe, it, expect, vi, beforeEach } from "vitest";
import { JinaEmbedder } from "../../../src/embedders/jina.js";

describe("JinaEmbedder", () => {
  const mockClient = {
    embed: vi.fn(),
  };

  beforeEach(() => {
    mockClient.embed.mockReset();
    mockClient.embed.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
    });
  });

  describe("constructor", () => {
    it("should use default model and dimensions when none specified", () => {
      const embedder = new JinaEmbedder({ client: mockClient });
      expect(embedder.name).toBe("Jina(jina-embeddings-v3)");
      expect(embedder.dimension).toBe(1024);
    });

    it("should use specified model", () => {
      const embedder = new JinaEmbedder({
        client: mockClient,
        model: "jina-embeddings-v2",
      });
      expect(embedder.name).toBe("Jina(jina-embeddings-v2)");
    });

    it("should use specified dimensions (Matryoshka)", () => {
      const embedder = new JinaEmbedder({
        client: mockClient,
        dimensions: 256,
      });
      expect(embedder.dimension).toBe(256);
    });

    it("should support small Matryoshka dimensions", () => {
      const embedder = new JinaEmbedder({
        client: mockClient,
        dimensions: 32,
      });
      expect(embedder.dimension).toBe(32);
    });
  });

  describe("embed()", () => {
    it("should call client.embed with task retrieval.passage", async () => {
      const embedder = new JinaEmbedder({ client: mockClient });
      await embedder.embed(["hello world"]);

      expect(mockClient.embed).toHaveBeenCalledWith({
        model: "jina-embeddings-v3",
        input: ["hello world"],
        task: "retrieval.passage",
        dimensions: 1024,
      });
    });

    it("should pass custom dimensions to client", async () => {
      const embedder = new JinaEmbedder({
        client: mockClient,
        dimensions: 512,
      });
      await embedder.embed(["text"]);

      expect(mockClient.embed).toHaveBeenCalledWith(
        expect.objectContaining({ dimensions: 512 }),
      );
    });

    it("should return embeddings from response data", async () => {
      mockClient.embed.mockResolvedValue({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 },
        ],
      });

      const embedder = new JinaEmbedder({ client: mockClient });
      const result = await embedder.embed(["text1", "text2"]);

      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
    });

    it("should spread readonly texts array", async () => {
      const embedder = new JinaEmbedder({ client: mockClient });
      const texts: readonly string[] = ["a", "b"];
      await embedder.embed(texts);

      expect(mockClient.embed).toHaveBeenCalledWith(
        expect.objectContaining({ input: ["a", "b"] }),
      );
    });
  });

  describe("embedQuery()", () => {
    it("should call client.embed with task retrieval.query", async () => {
      const embedder = new JinaEmbedder({ client: mockClient });
      await embedder.embedQuery("test query");

      expect(mockClient.embed).toHaveBeenCalledWith({
        model: "jina-embeddings-v3",
        input: ["test query"],
        task: "retrieval.query",
        dimensions: 1024,
      });
    });

    it("should return a single embedding vector", async () => {
      mockClient.embed.mockResolvedValue({
        data: [{ embedding: [0.5, 0.6, 0.7], index: 0 }],
      });

      const embedder = new JinaEmbedder({ client: mockClient });
      const result = await embedder.embedQuery("query");

      expect(result).toEqual([0.5, 0.6, 0.7]);
    });

    it("should pass custom dimensions to query embedding", async () => {
      const embedder = new JinaEmbedder({
        client: mockClient,
        dimensions: 128,
      });
      await embedder.embedQuery("query");

      expect(mockClient.embed).toHaveBeenCalledWith(
        expect.objectContaining({ dimensions: 128 }),
      );
    });
  });
});
