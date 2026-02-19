import type { Corpus, PositionAwareChunk } from "../types/index.js";
import type { Retriever } from "./retriever.interface.js";

export interface CallbackRetrieverConfig {
  readonly name: string;
  readonly retrieveFn: (query: string, k: number) => Promise<PositionAwareChunk[]>;
  readonly initFn?: (corpus: Corpus) => Promise<void>;
  readonly cleanupFn?: () => Promise<void>;
}

export class CallbackRetriever implements Retriever {
  readonly name: string;

  private _retrieveFn: CallbackRetrieverConfig["retrieveFn"];
  private _initFn: CallbackRetrieverConfig["initFn"];
  private _cleanupFn: CallbackRetrieverConfig["cleanupFn"];

  constructor(config: CallbackRetrieverConfig) {
    this.name = config.name;
    this._retrieveFn = config.retrieveFn;
    this._initFn = config.initFn;
    this._cleanupFn = config.cleanupFn;
  }

  async init(corpus: Corpus): Promise<void> {
    if (this._initFn) {
      await this._initFn(corpus);
    }
  }

  async retrieve(query: string, k: number): Promise<PositionAwareChunk[]> {
    return this._retrieveFn(query, k);
  }

  async cleanup(): Promise<void> {
    if (this._cleanupFn) {
      await this._cleanupFn();
    }
  }
}
