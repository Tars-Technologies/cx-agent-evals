"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { Spinner } from "@/components/shell/Spinner";
import { kbSidebar } from "@/components/shell/sidebars";
import { useKbBreadcrumb } from "@/lib/useKbBreadcrumb";
import { RetrieverWizard } from "@/components/wizard/RetrieverWizard";
import type { PipelineConfig } from "@/lib/pipeline-types";

export default function KbRetrieversPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const kbId = id as Id<"knowledgeBases">;
  const router = useRouter();

  const [showWizard, setShowWizard] = useState(false);

  const { labelOverrides } = useKbBreadcrumb(kbId);
  const retrievers = useQuery(api.crud.retrievers.byKb, { kbId });
  const createRetriever = useAction(api.retrieval.retrieverActions.create);

  return (
    <EntityDetailLayout
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(kbId)}
      breadcrumbLabelOverrides={labelOverrides}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium text-text">Retrievers</h2>
          <p className="text-[11px] text-text-dim mt-0.5">
            Configure retrieval pipelines for this knowledge base.
          </p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          + New Retriever
        </button>
      </div>

      {retrievers === undefined ? (
        <Spinner label="Loading…" />
      ) : retrievers.length === 0 ? (
        <div className="text-text-dim text-xs">
          No retrievers yet. Click <span className="text-accent">+ New Retriever</span> to create one.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {retrievers.map((r) => (
            <Link
              key={r._id}
              href={`/kb/${kbId}/retrievers/${r._id}`}
              className="block border border-border rounded-lg p-4 bg-bg-elevated hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-medium text-text truncate">{r.name}</h3>
                <span
                  className={`text-[10px] shrink-0 mt-0.5 px-1.5 py-0.5 rounded ${
                    r.status === "ready"
                      ? "bg-accent/10 text-accent"
                      : r.status === "indexing" || r.status === "pending"
                        ? "bg-yellow-500/10 text-yellow-400"
                        : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <div className="text-[10px] text-text-dim space-y-0.5">
                <div>k = {r.retrieverConfig.k ?? "—"}</div>
                {r.retrieverConfig.index?.chunkSize && (
                  <div>chunk = {r.retrieverConfig.index.chunkSize}</div>
                )}
              </div>
              <div className="mt-3 text-[11px] text-accent">Open →</div>
            </Link>
          ))}
        </div>
      )}

      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[720px] h-[85vh] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col">
            <RetrieverWizard
              onCreate={async (config, name) => {
                try {
                  const pConfig: PipelineConfig = {
                    name,
                    index: {
                      strategy: (config.index?.strategy ?? "plain") as "plain",
                      chunkSize: config.index?.chunkSize as number | undefined,
                      chunkOverlap: config.index?.chunkOverlap as number | undefined,
                    },
                    search: config.search as PipelineConfig["search"],
                    query: config.query as PipelineConfig["query"],
                    refinement: config.refinement as PipelineConfig["refinement"],
                    k: config.k,
                  };
                  const result = await createRetriever({
                    kbId,
                    retrieverConfig: pConfig,
                  });
                  setShowWizard(false);
                  router.push(`/kb/${kbId}/retrievers/${result.retrieverId}`);
                } catch (err) {
                  console.error("Failed to create retriever:", err);
                }
              }}
              onClose={() => setShowWizard(false)}
            />
          </div>
        </div>
      )}
    </EntityDetailLayout>
  );
}
