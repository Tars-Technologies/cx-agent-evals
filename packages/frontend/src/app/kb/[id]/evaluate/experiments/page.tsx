"use client";

import { use, useState } from "react";
import { Id } from "@convex/_generated/dataModel";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { kbSidebar } from "@/components/shell/sidebars";
import { useKbBreadcrumb } from "@/lib/useKbBreadcrumb";
import { CreateExperimentModal } from "@/components/experiments/CreateExperimentModal";
import { ExperimentSidebar } from "@/components/experiments/ExperimentSidebar";
import { ExperimentResults } from "@/components/experiments/ExperimentResults";

export default function KbExperimentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const kbId = id as Id<"knowledgeBases">;

  const { labelOverrides } = useKbBreadcrumb(kbId);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<Id<"experimentRuns"> | null>(null);

  return (
    <EntityDetailLayout
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(kbId)}
      breadcrumbLabelOverrides={labelOverrides}
      fullWidth
    >
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <h2 className="text-sm font-medium text-text">Experiments</h2>
          <p className="text-[11px] text-text-dim mt-0.5">
            Retriever evaluation runs.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          + Create Experiment
        </button>
      </div>

      <div className="flex border border-border rounded-lg overflow-hidden bg-bg-elevated flex-1 min-h-0">
        <ExperimentSidebar
          kbId={kbId}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
        />
        <ExperimentResults runId={selectedRunId} kbId={kbId} />
      </div>

      {showCreateModal && (
        <CreateExperimentModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          kbId={kbId}
          onCreated={(runId) => {
            setSelectedRunId(runId);
            setShowCreateModal(false);
          }}
        />
      )}
    </EntityDetailLayout>
  );
}
