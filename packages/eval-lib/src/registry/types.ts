import type { PipelineConfig } from "../retrievers/pipeline/config.js";

/** A single selectable value in a dropdown/radio group */
export interface Choice {
  /** Machine value stored in config */
  readonly value: string;
  /** Human-readable label */
  readonly label: string;
  /** Optional description shown when this choice is selected */
  readonly description?: string;
}

/** A configurable option exposed in the UI */
export interface OptionDef {
  /** Field name matching the config key, e.g., "model" */
  readonly key: string;
  /** Display label, e.g., "Model" */
  readonly label: string;
  /** 1-2 sentence explanation of what this option does */
  readonly description: string;
  /** Input type */
  readonly type: "select" | "number" | "boolean" | "string";
  /** Available choices for type: "select" */
  readonly choices?: readonly Choice[];
  /** Default value */
  readonly default: unknown;
  /** Constraints for type: "number" */
  readonly constraints?: {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
  };
  /** If true, hidden under an "Advanced" toggle in the wizard */
  readonly advanced?: boolean;
}

/** A registry entry for a provider, strategy, or component */
export interface RegistryEntry {
  /** Machine key, e.g., "cohere" */
  readonly id: string;
  /** Display name, e.g., "Cohere" */
  readonly name: string;
  /** 1-2 sentence explanation */
  readonly description: string;
  /**
   * Implementation status:
   * - "available": fully implemented, selectable in the wizard
   * - "coming-soon": shown in UI but disabled with "Coming soon" badge
   */
  readonly status: "available" | "coming-soon";
  /** Filterable tags, e.g., ["multilingual", "fast"] */
  readonly tags?: readonly string[];
  /** Configurable fields for this entry */
  readonly options: readonly OptionDef[];
  /** Default values for all options (keyed by OptionDef.key) */
  readonly defaults: Readonly<Record<string, unknown>>;
}

/**
 * A named preset with full PipelineConfig + UI metadata.
 * Extends RegistryEntry -- presets are browsable just like providers.
 */
export interface PresetEntry extends RegistryEntry {
  /** The actual PipelineConfig object this preset produces */
  readonly config: PipelineConfig;
  /** Complexity level for filtering/badges */
  readonly complexity: "basic" | "intermediate" | "advanced";
  /** Whether this preset requires an LLM (for query/index strategies) */
  readonly requiresLLM: boolean;
  /** Whether this preset requires a reranker (for refinement steps) */
  readonly requiresReranker: boolean;
  /** Human-readable summary of what each stage does */
  readonly stages: {
    readonly index: string;
    readonly query: string;
    readonly search: string;
    readonly refinement: string;
  };
}
