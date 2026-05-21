"use client";

import { use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { Spinner } from "@/components/shell/Spinner";
import { kbSidebar } from "@/components/shell/sidebars";
import { useKbBreadcrumb } from "@/lib/useKbBreadcrumb";
import { IndexTab } from "@/components/tabs/IndexTab";
import { QuerySearchTab } from "@/components/tabs/QuerySearchTab";
import { RefineTab } from "@/components/tabs/RefineTab";
import { PlaygroundTab } from "@/components/tabs/PlaygroundTab";

type TabId = "index" | "query-search" | "refine" | "playground";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "index", label: "Index" },
  { id: "query-search", label: "Query + Search" },
  { id: "refine", label: "Refine" },
  { id: "playground", label: "Playground" },
];

export default function KbRetrieverDetailPage({
  params,
}: {
  params: Promise<{ id: string; rid: string }>;
}) {
  const { id, rid } = use(params);
  const kbId = id as Id<"knowledgeBases">;
  const retrieverId = rid as Id<"retrievers">;
  const router = useRouter();

  const { labelOverrides: kbLabelOverrides } = useKbBreadcrumb(kbId);
  const retriever = useQuery(api.crud.retrievers.get, { id: retrieverId });

  const [activeTab, setActiveTab] = useState<TabId>("index");
  const [query, setQuery] = useState("");

  const startIndexingAction = useAction(api.retrieval.retrieverActions.startIndexing);
  const handleStartIndexing = useCallback(async () => {
    if (!retriever) return;
    try {
      await startIndexingAction({ retrieverId: retriever._id });
    } catch (err) {
      console.error("Failed to start indexing:", err);
    }
  }, [retriever, startIndexingAction]);

  const breadcrumbLabelOverrides = retriever
    ? { ...(kbLabelOverrides ?? {}), [retrieverId]: retriever.name }
    : kbLabelOverrides;

  return (
    <EntityDetailLayout
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(kbId)}
      breadcrumbLabelOverrides={breadcrumbLabelOverrides}
      fullWidth
    >
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text truncate">
            {retriever?.name ?? "Loading…"}
          </h2>
          {retriever && (
            <p className="text-[11px] text-text-dim mt-0.5">
              status: {retriever.status} · k = {retriever.retrieverConfig.k ?? "—"}
            </p>
          )}
        </div>
        <button
          onClick={() => router.push(`/kb/${kbId}/evaluate/retrievers`)}
          className="text-[11px] text-text-dim hover:text-text transition-colors"
        >
          ← All retrievers
        </button>
      </div>

      <div className="flex flex-col border border-border rounded-lg overflow-hidden bg-bg-elevated flex-1 min-h-0">
        <div className="flex gap-0 border-b border-border bg-bg-elevated px-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "border-b-2 border-accent text-accent font-medium"
                  : "text-text-dim hover:text-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          {retriever ? (
            <>
              {activeTab === "index" && (
                <IndexTab retriever={retriever} onStartIndexing={handleStartIndexing} />
              )}
              {activeTab === "query-search" && (
                <QuerySearchTab retriever={retriever} query={query} onQueryChange={setQuery} />
              )}
              {activeTab === "refine" && (
                <RefineTab retriever={retriever} query={query} onQueryChange={setQuery} />
              )}
              {activeTab === "playground" && (
                <PlaygroundTab
                  selectedRetrieverIds={new Set([retriever._id])}
                  retrievers={[retriever]}
                />
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <Spinner size="md" label="Loading…" />
            </div>
          )}
        </div>
      </div>
    </EntityDetailLayout>
  );
}
