import { describe, it, expect, vi, beforeEach } from "vitest";
import { CohereEmbedder } from "../../../src/embedders/cohere.js";

describe("CohereEmbedder", () => {
  const mockClient = {
    embed: vi.fn(),
  };

  beforeEach(() => {
    mockClient.embed.mockReset();
    mockClient.embed.mockResolvedValue({
      embeddings: { float: [[0.1, 0.2, 0.3]] },
    });
  });

  describe("constructor", () => {
    it("should use default model when none specified", () => {
      const embedder = new CohereEmbedder({ client: mockClient });
      expect(embedder.name).toBe("Cohere(embed-english-v3.0)");
      expect(embedder.dimension).toBe(1024);
    });

    it("should use specified model", () => {
      const embedder = new CohereEmbedder({
        client: mockClient,
        model: "embed-multilingual-v3.0",
      });
      expect(embedder.name).toBe("Cohere(embed-multilingual-v3.0)");
      expect(embedder.dimension).toBe(1024);
    });

    it("should fall back to 1024 dimensions for unknown model", () => {
      const embedder = new CohereEmbedder({
        client: mockClient,
        model: "embed-future-v4.0",
      });
      expect(embedder.name).toBe("Cohere(embed-future-v4.0)");
      expect(embedder.dimension).toBe(1024);
    });
  });

  describe("embed()", () => {
    it("should call client.embed with inputType search_document", async () => {
      const embedder = new CohereEmbedder({
        client: mockClient,
        model: "embed-english-v3.0",
      });
      await embedder.embed(["hello world"]);

      expect(mockClient.embed).toHaveBeenCalledWith({
        model: "embed-english-v3.0",
        texts: ["hello world"],
        inputType: "search_document",
        embeddingTypes: ["float"],
      });
    });

    it("should return embeddings from response", async () => {
      mockClient.embed.mockResolvedValue({
        embeddings: {
          float: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        },
      });

      const embedder = new CohereEmbedder({ client: mockClient });
      const result = await embedder.embed(["text1", "text2"]);

      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
    });

    it("should spread readonly texts array", async () => {
      const embedder = new CohereEmbedder({ client: mockClient });
      const texts: readonly string[] = ["a", "b"];
      await embedder.embed(texts);

      expect(mockClient.embed).toHaveBeenCalledWith(
        expect.objectContaining({ texts: ["a", "b"] }),
      );
    });
  });

  describe("embedQuery()", () => {
    it("should call client.embed with inputType search_query", async () => {
      const embedder = new CohereEmbedder({ client: mockClient });
      await embedder.embedQuery("test query");

      expect(mockClient.embed).toHaveBeenCalledWith({
        model: "embed-english-v3.0",
        texts: ["test query"],
        inputType: "search_query",
        embeddingTypes: ["float"],
      });
    });

    it("should return a single embedding vector", async () => {
      mockClient.embed.mockResolvedValue({
        embeddings: { float: [[0.5, 0.6, 0.7]] },
      });

      const embedder = new CohereEmbedder({ client: mockClient });
      const result = await embedder.embedQuery("query");

      expect(result).toEqual([0.5, 0.6, 0.7]);
    });

    it("should NOT delegate to embed() — calls client directly", async () => {
      const embedder = new CohereEmbedder({ client: mockClient });
      const embedSpy = vi.spyOn(embedder, "embed");

      await embedder.embedQuery("direct call");

      expect(embedSpy).not.toHaveBeenCalled();
      expect(mockClient.embed).toHaveBeenCalledTimes(1);
      expect(mockClient.embed).toHaveBeenCalledWith(
        expect.objectContaining({ inputType: "search_query" }),
      );
    });
  });
});
