"use client";

import { useState, useCallback, useEffect } from "react";
import { PRESET_REGISTRY } from "rag-evaluation-system/registry";
import { WizardNav } from "./WizardNav";
import { ChoosePresetStep } from "./steps/ChoosePresetStep";
import { IndexStep } from "./steps/IndexStep";
import { QueryStep } from "./steps/QueryStep";
import { SearchStep } from "./steps/SearchStep";
import { RefinementStep } from "./steps/RefinementStep";
import { ReviewStep } from "./steps/ReviewStep";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RetrieverWizardProps {
  initialConfig?: {
    name: string;
    indexStrategy?: string;
    chunkerType?: string;
    chunkerOptions?: Record<string, unknown>;
    embedderProvider?: string;
    embedderOptions?: Record<string, unknown>;
    queryStrategy?: string;
    searchStrategy?: string;
    searchOptions?: Record<string, unknown>;
    k?: number;
    refinementSteps?: Array<{ type: string; [key: string]: unknown }>;
    rerankerProvider?: string;
    rerankerOptions?: Record<string, unknown>;
  };
  basePreset?: string;
  onCreate: (config: BuiltConfig, name: string) => void;
  onClose: () => void;
}

interface BuiltConfig {
  name: string;
  index?: { strategy: string; chunkSize?: number; chunkOverlap?: number; [key: string]: unknown };
  query?: { strategy: string; [key: string]: unknown };
  search?: { strategy: string; [key: string]: unknown };
  refinement?: Array<{ type: string; [key: string]: unknown }>;
  k?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract search options from a config.search object, stripping the strategy field */
function extractSearchOptions(
  search: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!search) return {};
  const { strategy: _, ...options } = search;
  return options;
}

/**
 * Build a human-readable sentence-style name from config.
 * Priority: search strategy > query rewriting > refinement > k > chunking.
 */
function buildAutoName(presetId: string | null, config: BuiltConfig): string {
  // If a preset is selected and name matches, use the preset id
  if (presetId) {
    const preset = PRESET_REGISTRY.find((p) => p.id === presetId);
    if (preset) return presetId;
  }

  const parts: string[] = [];

  // Chunking prefix (only if non-default)
  const chunkSize = config.index?.chunkSize;
  const strategy = config.index?.strategy;
  if (strategy === "parent-child") {
    parts.push("Parent-child,");
  } else if (chunkSize && chunkSize !== 1000) {
    parts.push(`Recursive-${chunkSize},`);
  }

  // Search strategy (always — this is the lead)
  const searchStrategy = config.search?.strategy ?? "dense";
  const searchLabel =
    searchStrategy.charAt(0).toUpperCase() + searchStrategy.slice(1);
  parts.push(`${searchLabel} search`);

  // Query rewriting (if non-default)
  const queryStrategy = config.query?.strategy;
  if (queryStrategy && queryStrategy !== "identity") {
    const queryLabel = queryStrategy.replace(/_/g, " ");
    parts.push(`${queryLabel} rewriting`);
  }

  // Refinement
  const refinement = config.refinement;
  if (refinement && refinement.length > 0) {
    const types = refinement.map((s) => s.type);
    if (types.length === 1) {
      parts.push(`with ${types[0]}`);
    } else {
      parts.push(`with ${types.join(" + ")}`);
    }
  }

  // k value
  const k = config.k ?? 5;
  parts.push(`(k=${k})`);

  // Join with appropriate separators
  // "Dense search with reranking (k=5)"
  // "Parent-child, Hybrid search, HyDE rewriting, with rerank + threshold (k=10)"
  let name = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("with ") || part.startsWith("(")) {
      name += ` ${part}`;
    } else {
      name += `, ${part}`;
    }
  }

  return name;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RetrieverWizard({
  initialConfig,
  basePreset,
  onCreate,
  onClose,
}: RetrieverWizardProps) {
  // ---- Navigation ----
  const [currentStep, setCurrentStep] = useState(0);

  // ---- Preset ----
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    basePreset ?? null,
  );

  // ---- Name ----
  const [name, setName] = useState(initialConfig?.name ?? "");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  // ---- Index ----
  const [indexStrategy, setIndexStrategy] = useState(
    initialConfig?.indexStrategy ?? "plain",
  );
  const [chunkerType, setChunkerType] = useState(
    initialConfig?.chunkerType ?? "recursive-character",
  );
  const [chunkerOptions, setChunkerOptions] = useState<Record<string, unknown>>(
    initialConfig?.chunkerOptions ?? { chunkSize: 1000, chunkOverlap: 200 },
  );
  const [embedderProvider, setEmbedderProvider] = useState(
    initialConfig?.embedderProvider ?? "openai",
  );
  const [embedderOptions, setEmbedderOptions] = useState<Record<string, unknown>>(
    initialConfig?.embedderOptions ?? { model: "text-embedding-3-small" },
  );

  // ---- Query ----
  const [queryStrategy, setQueryStrategy] = useState(
    initialConfig?.queryStrategy ?? "identity",
  );

  // ---- Search ----
  const [searchStrategy, setSearchStrategy] = useState(
    initialConfig?.searchStrategy ?? "dense",
  );
  const [searchOptions, setSearchOptions] = useState<Record<string, unknown>>(
    initialConfig?.searchOptions ?? {},
  );
  const [k, setK] = useState(initialConfig?.k ?? 5);

  // ---- Refinement ----
  const [refinementSteps, setRefinementSteps] = useState<
    Array<{ type: string; [key: string]: unknown }>
  >(initialConfig?.refinementSteps ?? []);
  const [rerankerProvider, setRerankerProvider] = useState(
    initialConfig?.rerankerProvider ?? "cohere",
  );
  const [rerankerOptions, setRerankerOptions] = useState<Record<string, unknown>>(
    initialConfig?.rerankerOptions ?? { model: "rerank-english-v3.0" },
  );

  // ---- Build config ----
  const buildConfig = useCallback((): BuiltConfig => {
    const config: BuiltConfig = { name };

    // Index
    config.index = { strategy: indexStrategy, ...chunkerOptions };

    // Query
    if (queryStrategy !== "identity") {
      config.query = { strategy: queryStrategy };
    }

    // Search
    config.search = { strategy: searchStrategy, ...searchOptions };

    // Refinement
    if (refinementSteps.length > 0) {
      config.refinement = refinementSteps;
    }

    config.k = k;
    return config;
  }, [name, indexStrategy, chunkerOptions, queryStrategy, searchStrategy, searchOptions, refinementSteps, k]);

  // ---- Auto-naming ----
  useEffect(() => {
    if (nameManuallyEdited) return;
    const config = buildConfig();
    setName(buildAutoName(selectedPresetId, config));
  }, [
    nameManuallyEdited,
    selectedPresetId,
    buildConfig,
  ]);

  // ---- Preset selection logic ----
  const handlePresetSelect = useCallback(
    (presetId: string | null) => {
      setSelectedPresetId(presetId);

      if (presetId === null) {
        // Start from scratch — reset to defaults
        setIndexStrategy("plain");
        setChunkerType("recursive-character");
        setChunkerOptions({ chunkSize: 1000, chunkOverlap: 200 });
        setEmbedderProvider("openai");
        setEmbedderOptions({ model: "text-embedding-3-small" });
        setQueryStrategy("identity");
        setSearchStrategy("dense");
        setSearchOptions({});
        setK(5);
        setRefinementSteps([]);
        setRerankerProvider("cohere");
        setRerankerOptions({ model: "rerank-english-v3.0" });
        if (!nameManuallyEdited) {
          setName("");
        }
        setCurrentStep(1); // Advance to Index step
        return;
      }

      const preset = PRESET_REGISTRY.find((p) => p.id === presetId);
      if (!preset) return;

      const cfg = preset.config as unknown as Record<string, unknown>;
      const indexCfg = cfg.index as Record<string, unknown> | undefined;
      const searchCfg = cfg.search as Record<string, unknown> | undefined;
      const queryCfg = cfg.query as Record<string, unknown> | undefined;
      const refinementCfg = cfg.refinement as
        | Array<{ type: string; [key: string]: unknown }>
        | undefined;

      // Pre-fill state from preset config
      setIndexStrategy(
        (indexCfg?.strategy as string) ?? "plain",
      );

      // Extract chunker options from index config (chunkSize, chunkOverlap, etc.)
      if (indexCfg) {
        const { strategy: _, ...indexOpts } = indexCfg;
        if (Object.keys(indexOpts).length > 0) {
          setChunkerOptions({
            chunkSize: 1000,
            chunkOverlap: 200,
            ...indexOpts,
          });
        } else {
          setChunkerOptions({ chunkSize: 1000, chunkOverlap: 200 });
        }
      }

      setQueryStrategy(
        (queryCfg?.strategy as string) ?? "identity",
      );

      setSearchStrategy(
        (searchCfg?.strategy as string) ?? "dense",
      );
      setSearchOptions(extractSearchOptions(searchCfg));

      setRefinementSteps(refinementCfg ?? []);

      if (!nameManuallyEdited) {
        setName(presetId);
      }

      // Auto-advance to Review step
      setCurrentStep(5);
    },
    [nameManuallyEdited],
  );

  // ---- Name change handler ----
  const handleNameChange = useCallback((newName: string) => {
    setName(newName);
    setNameManuallyEdited(true);
  }, []);

  // ---- Chunker change handler ----
  const handleChunkerChange = useCallback(
    (type: string, options: Record<string, unknown>) => {
      setChunkerType(type);
      setChunkerOptions(options);
    },
    [],
  );

  // ---- Embedder change handler ----
  const handleEmbedderChange = useCallback(
    (provider: string, options: Record<string, unknown>) => {
      setEmbedderProvider(provider);
      setEmbedderOptions(options);
    },
    [],
  );

  // ---- Search change handler ----
  const handleSearchChange = useCallback(
    (strategy: string, options: Record<string, unknown>) => {
      setSearchStrategy(strategy);
      setSearchOptions(options);
    },
    [],
  );

  // ---- Reranker change handler ----
  const handleRerankerChange = useCallback(
    (provider: string, options: Record<string, unknown>) => {
      setRerankerProvider(provider);
      setRerankerOptions(options);
    },
    [],
  );

  // ---- ReviewStep edit handler (maps section index to wizard step) ----
  const handleEditStep = useCallback((sectionIndex: number) => {
    // ReviewStep sections: 0=Index, 1=Query, 2=Search, 3=Refinement
    // Wizard steps: 0=Preset, 1=Index, 2=Query, 3=Search, 4=Refinement, 5=Review
    setCurrentStep(sectionIndex + 1);
  }, []);

  // ---- Create handler ----
  const handleCreate = useCallback(() => {
    const config = buildConfig();
    onCreate(config, name);
  }, [buildConfig, name, onCreate]);

  // ---- Render ----
  return (
    <div className="flex flex-col h-full">
      {/* Header with close button */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-sm font-medium text-text">Configure Retriever</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-text-dim hover:text-text transition-colors cursor-pointer text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Nav */}
      <WizardNav
        currentStep={currentStep}
        totalSteps={TOTAL_STEPS}
        onStepClick={setCurrentStep}
      />

      {/* Step content -- scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {currentStep === 0 && (
          <ChoosePresetStep
            selectedPresetId={selectedPresetId}
            onSelectPreset={handlePresetSelect}
          />
        )}

        {currentStep === 1 && (
          <IndexStep
            indexStrategy={indexStrategy}
            chunkerType={chunkerType}
            chunkerOptions={chunkerOptions}
            embedderProvider={embedderProvider}
            embedderOptions={embedderOptions}
            onIndexStrategyChange={setIndexStrategy}
            onChunkerChange={handleChunkerChange}
            onEmbedderChange={handleEmbedderChange}
          />
        )}

        {currentStep === 2 && (
          <QueryStep
            queryStrategy={queryStrategy}
            onQueryStrategyChange={setQueryStrategy}
          />
        )}

        {currentStep === 3 && (
          <SearchStep
            searchStrategy={searchStrategy}
            searchOptions={searchOptions}
            k={k}
            onSearchChange={handleSearchChange}
            onKChange={setK}
          />
        )}

        {currentStep === 4 && (
          <RefinementStep
            steps={refinementSteps}
            rerankerProvider={rerankerProvider}
            rerankerOptions={rerankerOptions}
            onStepsChange={setRefinementSteps}
            onRerankerChange={handleRerankerChange}
          />
        )}

        {currentStep === 5 && (
          <ReviewStep
            config={{
              name,
              indexStrategy,
              chunkerType,
              chunkerOptions,
              embedderProvider,
              embedderOptions,
              queryStrategy,
              searchStrategy,
              searchOptions,
              k,
              refinementSteps,
              rerankerProvider,
              rerankerOptions,
            }}
            basePreset={selectedPresetId}
            onNameChange={handleNameChange}
            onEditStep={handleEditStep}
          />
        )}
      </div>

      {/* Footer: Back / Next buttons */}
      <div className="flex items-center justify-between p-4 border-t border-border">
        <button
          type="button"
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
          disabled={currentStep === 0}
          className="text-xs text-text-muted hover:text-text disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          &larr; Back
        </button>
        {currentStep < 5 ? (
          <button
            type="button"
            onClick={() => setCurrentStep((s) => s + 1)}
            className="text-xs bg-accent text-bg px-3 py-1.5 rounded hover:bg-accent-bright font-medium transition-colors cursor-pointer"
          >
            Next &rarr;
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCreate}
            className="text-xs bg-accent text-bg px-3 py-1.5 rounded hover:bg-accent-bright font-medium transition-colors cursor-pointer"
          >
            Create Retriever
          </button>
        )}
      </div>
    </div>
  );
}
