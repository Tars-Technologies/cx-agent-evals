"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

import { ConfigurePanel } from "./ConfigurePanel";
import { ValidatePanel } from "./ValidatePanel";
import { RunPanel } from "./RunPanel";

type Tab = "configure" | "validate" | "run";

interface EvaluatorWorkspaceProps {
  configId: Id<"evaluatorConfigs"> | null;
  kbId: Id<"knowledgeBases">;
}

export function EvaluatorWorkspace({
  configId,
  kbId,
}: EvaluatorWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>("configure");

  const config = useQuery(
    api.evaluator.crud.getConfig,
    configId ? { id: configId } : "skip",
  );

  // Resolve experiment for context
  const experiment = useQuery(
    api.experiments.orchestration.get,
    config?.experimentId ? { id: config.experimentId } : "skip",
  );

  // Resolve failure mode for header
  const failureModes = useQuery(
    api.failureModes.crud.byExperiment,
    config?.experimentId ? { experimentId: config.experimentId } : "skip",
  );
  const failureMode = failureModes?.find(
    (fm) => fm._id === config?.failureModeId,
  );

  if (!configId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">&#9878;</div>
          <h2 className="text-lg font-medium text-text mb-2">
            Select an Evaluator
          </h2>
          <p className="text-sm text-text-dim">
            Choose an evaluator from the sidebar or create a new one to get
            started.
          </p>
        </div>
      </div>
    );
  }

  if (!config || !experiment) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
        Loading...
      </div>
    );
  }

  const tabs: { key: Tab; label: string; disabled: boolean }[] = [
    { key: "configure", label: "Configure", disabled: false },
    {
      key: "validate",
      label: "Validate",
      disabled: false,
    },
    {
      key: "run",
      label: "Run",
      disabled: !config.testMetrics,
    },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Workspace header */}
      <div className="border-b border-border bg-bg-elevated px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text">
              {failureMode?.name ?? config.name}
            </div>
            <div className="text-xs text-text-dim mt-0.5">
              {experiment.name}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border bg-bg px-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => !tab.disabled && setActiveTab(tab.key)}
            disabled={tab.disabled}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-accent text-accent"
                : tab.disabled
                  ? "border-transparent text-text-dim/40 cursor-not-allowed"
                  : "border-transparent text-text-dim hover:text-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {activeTab === "configure" && (
          <ConfigurePanel config={config} experimentId={config.experimentId} />
        )}
        {activeTab === "validate" && (
          <ValidatePanel config={config} experimentId={config.experimentId} />
        )}
        {activeTab === "run" && (
          <RunPanel
            config={config}
            experimentId={config.experimentId}
            experiment={experiment}
          />
        )}
      </div>
    </div>
  );
}
