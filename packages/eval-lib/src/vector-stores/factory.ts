import type { CallbackVectorStoreConfig } from "./callback.js"
import { CallbackVectorStore } from "./callback.js"
import { InMemoryVectorStore } from "./in-memory.js"
import type { VectorStore } from "./vector-store.interface.js"

export type VectorStoreConfig =
  | { readonly backend: "native" }
  | { readonly backend: "memory" }

export interface VectorStoreHooks {
  /** Host-supplied capabilities for the "native" backend. */
  readonly native?: CallbackVectorStoreConfig
}

/**
 * Build a VectorStore for the selected backend.
 *
 * - native: wraps host-supplied callbacks (requires hooks.native) - the host
 *   application executes the actual vector operations.
 * - memory: in-process store for tests and local experiments.
 */
export function makeVectorStore(
  config: VectorStoreConfig,
  hooks?: VectorStoreHooks
): VectorStore {
  switch (config.backend) {
    case "native": {
      if (!hooks?.native) {
        throw new Error(
          'makeVectorStore: backend "native" requires hooks.native'
        )
      }
      return new CallbackVectorStore(hooks.native)
    }
    case "memory":
      return new InMemoryVectorStore()
    default:
      throw new Error(
        `Unknown vector store backend: ${(config as { backend: string }).backend}`
      )
  }
}
