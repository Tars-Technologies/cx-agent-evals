import type { Corpus, PositionAwareChunk } from "../types/index.js";

export interface Retriever {
  readonly name: string;
  init(corpus: Corpus): Promise<void>;
  retrieve(query: string, k: number): Promise<PositionAwareChunk[]>;
  cleanup(): Promise<void>;
}
