"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import type { Dimension, PromptPreferences, UnifiedWizardConfig } from "@/lib/types";
import { WizardStepRealWorld } from "./WizardStepRealWorld";
import { WizardStepDimensions } from "./WizardStepDimensions";
import { WizardStepPreferences } from "./WizardStepPreferences";
import { WizardStepReview } from "./WizardStepReview";

const WIZARD_CONFIG_PREFIX = "rag-eval:unified-wizard-config:";
const OLD_WIZARD_CONFIG_KEY = "rag-eval:unified-wizard-config";
const wizardKey = (kbId: string) => `${WIZARD_CONFIG_PREFIX}${kbId}`;

const DEFAULT_PREFERENCES: PromptPreferences = {
  questionTypes: ["factoid", "procedural", "conditional"],
  tone: "professional but accessible",
  focusAreas: "",
};

const DEFAULT_CONFIG: UnifiedWizardConfig = {
  realWorldQuestions: [],
  dimensions: [],
  preferences: DEFAULT_PREFERENCES,
  totalQuestions: 30,
  allocationOverrides: {},
};

const STEPS = ["Real-World Qs", "Dimensions", "Preferences", "Review"];

interface DocInfo {
  _id: string;
  docId: string;
  title: string;
  priority: number;
}

interface GenerationWizardProps {
  kbId: Id<"knowledgeBases">;
  documents: DocInfo[];
  generating: boolean;
  disabledReason?: string;
  onGenerated: (datasetId: Id<"datasets">, jobId: Id<"generationJobs">) => void;
  onError: (error: string) => void;
}

export function GenerationWizard({
  kbId,
  documents,
  generating,
  disabledReason,
  onGenerated,
  onError,
}: GenerationWizardProps) {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<UnifiedWizardConfig>(() => {
    try {
      const saved = localStorage.getItem(wizardKey(kbId));
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch {
      // Ignore corrupted localStorage
    }
    return DEFAULT_CONFIG;
  });

  // Persist config to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(wizardKey(kbId), JSON.stringify(config));
    } catch {
      // localStorage full or unavailable
    }
  }, [config, kbId]);

  // Reload config when KB changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(wizardKey(kbId));
      if (saved) {
        setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
      } else {
        setConfig(DEFAULT_CONFIG);
      }
    } catch {
      setConfig(DEFAULT_CONFIG);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId]);

  // One-time migration from the old global storage key
  useEffect(() => {
    try {
      const oldValue = localStorage.getItem(OLD_WIZARD_CONFIG_KEY);
      if (oldValue == null) return;
      const currentKey = wizardKey(kbId);
      // Only seed if this KB doesn't already have its own entry
      if (localStorage.getItem(currentKey) == null) {
        localStorage.setItem(currentKey, oldValue);
      }
      localStorage.removeItem(OLD_WIZARD_CONFIG_KEY);
    } catch {
      // Silent — migration is best-effort
    }
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Document priorities (local state, syncs to Convex on change)
  const [docPriorities, setDocPriorities] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    documents.forEach((d) => {
      map[d._id] = d.priority ?? 3;
    });
    return map;
  });

  const updatePriority = useMutation(api.crud.documents.updatePriority);
  const startGeneration = useMutation(api.generation.orchestration.startGeneration);

  const handlePriorityChange = useCallback(
    async (docId: string, priority: number) => {
      setDocPriorities((prev) => ({ ...prev, [docId]: priority }));
      try {
        await updatePriority({ documentId: docId as Id<"documents">, priority });
      } catch {
        // Best-effort sync
      }
    },
    [updatePriority],
  );

  const docsWithPriority: DocInfo[] = documents.map((d) => ({
    ...d,
    priority: docPriorities[d._id] ?? 3,
  }));

  async function handleGenerate() {
    if (!kbId || generating) return;
    try {
      const strategyConfig: Record<string, unknown> = {
        totalQuestions: config.totalQuestions,
        promptPreferences: config.preferences,
      };
      if (config.realWorldQuestions.length > 0) {
        strategyConfig.realWorldQuestions = config.realWorldQuestions;
      }
      if (config.dimensions.length > 0) {
        strategyConfig.dimensions = config.dimensions;
      }
      if (Object.keys(config.allocationOverrides).length > 0) {
        strategyConfig.allocationOverrides = config.allocationOverrides;
      }

      const result = await startGeneration({
        kbId,
        name: `unified-${Date.now()}`,
        strategy: "unified",
        strategyConfig,
      });

      onGenerated(result.datasetId, result.jobId);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to start generation");
    }
  }

  return (
    <div className="space-y-3">
      {/* Stepper */}
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <button
            key={label}
            onClick={() => setStep(i)}
            className={`flex-1 text-[10px] py-1 rounded transition-colors ${
              i === step
                ? "bg-accent-dim text-accent-bright"
                : i < step
                  ? "text-accent hover:bg-accent/5"
                  : "text-text-dim"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Step content */}
      {step === 0 && (
        <WizardStepRealWorld
          questions={config.realWorldQuestions}
          onChange={(qs) => setConfig((prev) => ({ ...prev, realWorldQuestions: qs }))}
          onNext={() => setStep(1)}
          onSkip={() => setStep(1)}
        />
      )}
      {step === 1 && (
        <WizardStepDimensions
          dimensions={config.dimensions}
          onChange={(dims) => setConfig((prev) => ({ ...prev, dimensions: dims }))}
          onNext={() => setStep(2)}
          onSkip={() => setStep(2)}
          onBack={() => setStep(0)}
        />
      )}
      {step === 2 && (
        <WizardStepPreferences
          preferences={config.preferences}
          onChange={(prefs) => setConfig((prev) => ({ ...prev, preferences: prefs }))}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <WizardStepReview
          config={config}
          documents={docsWithPriority}
          onTotalQuestionsChange={(n) => setConfig((prev) => ({ ...prev, totalQuestions: n }))}
          onPriorityChange={handlePriorityChange}
          onGenerate={handleGenerate}
          onBack={() => setStep(2)}
          onEditStep={(s) => setStep(s)}
          generating={generating}
          disabled={!documents.length}
          disabledReason={disabledReason}
        />
      )}
    </div>
  );
}
