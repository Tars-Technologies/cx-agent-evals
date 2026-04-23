"use client";

import { Suspense, useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { KBDropdown } from "@/components/KBDropdown";
import { useKbFromUrl } from "@/lib/useKbFromUrl";

import { EvaluatorSidebar } from "./_components/EvaluatorSidebar";
import { EvaluatorWorkspace } from "./_components/EvaluatorWorkspace";
import { NewEvaluatorModal } from "./_components/NewEvaluatorModal";

export default function EvaluatorsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-screen">
          <Header mode="evaluators" />
        </div>
      }
    >
      <EvaluatorsPageContent />
    </Suspense>
  );
}

function EvaluatorsPageContent() {
  const [selectedKbId, setSelectedKbId] = useKbFromUrl();
  const [selectedConfigId, setSelectedConfigId] =
    useState<Id<"evaluatorConfigs"> | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  // Load evaluator configs for selected KB
  const configs = useQuery(
    api.evaluator.crud.configsByKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );

  // Reset selection when KB changes
  useEffect(() => {
    setSelectedConfigId(null);
  }, [selectedKbId]);

  // Auto-select first config if none selected
  useEffect(() => {
    if (!selectedConfigId && configs && configs.length > 0) {
      setSelectedConfigId(configs[0]._id);
    }
  }, [configs, selectedConfigId]);

  return (
    <div className="flex flex-col h-screen">
      <Header mode="evaluators" kbId={selectedKbId} />

      {/* KB Selector bar */}
      <div className="border-b border-border bg-bg-elevated px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-dim uppercase tracking-wide">
            Knowledge Base:
          </span>
          <KBDropdown
            selectedKbId={selectedKbId}
            onSelect={setSelectedKbId}
          />
        </div>
      </div>

      {/* Sidebar + Workspace */}
      <div className="flex-1 overflow-hidden flex">
        {selectedKbId ? (
          <>
            <EvaluatorSidebar
              configs={configs ?? []}
              selectedConfigId={selectedConfigId}
              onSelectConfig={setSelectedConfigId}
              onNewEvaluator={() => setShowNewModal(true)}
              loading={configs === undefined}
            />

            <EvaluatorWorkspace
              configId={selectedConfigId}
              kbId={selectedKbId}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
            Select a knowledge base to view evaluators
          </div>
        )}
      </div>

      {showNewModal && selectedKbId && (
        <NewEvaluatorModal
          kbId={selectedKbId}
          onClose={() => setShowNewModal(false)}
          onCreated={(configId) => {
            setSelectedConfigId(configId);
            setShowNewModal(false);
          }}
        />
      )}
    </div>
  );
}
