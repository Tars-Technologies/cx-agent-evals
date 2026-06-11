"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { Spinner } from "@/components/shell/Spinner";
import { ErrorToast } from "@/components/shell/ErrorToast";
import { kbSidebar } from "@/components/shell/sidebars";
import { useKbBreadcrumb } from "@/lib/useKbBreadcrumb";
import { GenerationWizard } from "@/components/GenerationWizard";
import { GenerationBanner } from "@/components/GenerationBanner";

export default function KbDatasetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const kbId = id as Id<"knowledgeBases">;
  const router = useRouter();

  const [showWizardModal, setShowWizardModal] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const { kb: selectedKb, labelOverrides } = useKbBreadcrumb(kbId);
  const kbDatasets = useQuery(api.crud.datasets.byKb, { kbId });

  const activeJob = useQuery(api.generation.orchestration.getActiveJob, {});
  const activeJobKb = useQuery(
    api.crud.knowledgeBases.get,
    activeJob ? { id: activeJob.kbId } : "skip",
  );

  const filteredDatasets = (kbDatasets ?? []).filter(
    (ds) => !ds.type || ds.type === "questions",
  );

  const hasDocuments: boolean | undefined =
    selectedKb === undefined ? undefined : (selectedKb?.documentCount ?? 0) > 0;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && showWizardModal) {
        setShowWizardModal(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showWizardModal]);

  return (
    <EntityDetailLayout
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(kbId)}
      breadcrumbLabelOverrides={labelOverrides}
    >
      {activeJob && (
        <div className="mb-4">
          <GenerationBanner
            strategy={activeJob.strategy}
            kbName={activeJobKb?.name ?? "..."}
            phase={activeJob.phase}
            processedItems={activeJob.processedItems}
            totalItems={activeJob.totalItems}
            questionsGenerated={activeJob.questionsGenerated ?? 0}
            onView={() => {
              const targetKb = activeJob.kbId;
              router.push(`/kb/${targetKb}/evaluate/datasets/${activeJob.datasetId}`);
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h2 className="text-sm font-medium text-text">Datasets</h2>
          <p className="text-[11px] text-text-dim mt-0.5">
            Synthetic question datasets for retrieval evaluation.
          </p>
        </div>
        <button
          onClick={() => setShowWizardModal(true)}
          disabled={hasDocuments !== true || !!activeJob}
          title={
            hasDocuments === undefined
              ? "Loading…"
              : hasDocuments === false
                ? "Upload documents before generating"
                : activeJob
                  ? "A generation is already in progress"
                  : undefined
          }
          className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + New Generation
        </button>
      </div>

      {kbDatasets === undefined ? (
        <Spinner label="Loading…" />
      ) : filteredDatasets.length === 0 ? (
        <div className="text-text-dim text-xs">
          No question datasets yet.
          {hasDocuments === false ? " Upload documents in Configure first." : ""}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredDatasets.map((ds) => {
            const isGenerating = activeJob?.datasetId === ds._id;
            return (
              <Link
                key={ds._id}
                href={`/kb/${kbId}/evaluate/datasets/${ds._id}`}
                className="block border border-border rounded-lg p-4 bg-bg-elevated hover:border-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-medium text-text truncate">{ds.name}</h3>
                  {isGenerating && (
                    <span className="text-[10px] text-accent shrink-0 mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                      generating
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-text-dim space-y-0.5">
                  <div>{ds.questionCount} questions</div>
                  <div>strategy: {ds.strategy}</div>
                </div>
                <div className="mt-3 text-[11px] text-accent">Open →</div>
              </Link>
            );
          })}
        </div>
      )}

      {showWizardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowWizardModal(false)} />
          <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto animate-fade-in">
            <GenerationWizard
              kbId={kbId}
              generating={!!activeJob}
              disabledReason={activeJob ? "Only one generation at a time" : undefined}
              onGenerated={(dsId) => {
                setShowWizardModal(false);
                router.push(`/kb/${kbId}/evaluate/datasets/${dsId}`);
              }}
              onError={(err) => {
                setGenError(err);
                setShowWizardModal(false);
              }}
              onCancel={() => setShowWizardModal(false)}
            />
          </div>
        </div>
      )}

      {genError && <ErrorToast message={genError} onDismiss={() => setGenError(null)} />}
    </EntityDetailLayout>
  );
}
