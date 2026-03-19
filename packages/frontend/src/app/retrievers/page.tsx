"use client";

import { Suspense, useState, useCallback } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useKbFromUrl } from "@/lib/useKbFromUrl";
import { RetrieverWizard } from "@/components/wizard/RetrieverWizard";
import { RetrieverSidebar } from "@/components/RetrieverSidebar";
import { IndexTab } from "@/components/tabs/IndexTab";
import { QuerySearchTab } from "@/components/tabs/QuerySearchTab";
import { RefineTab } from "@/components/tabs/RefineTab";
import { PlaygroundTab } from "@/components/tabs/PlaygroundTab";
import type { PipelineConfig } from "@/lib/pipeline-types";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = "index" | "query-search" | "refine" | "playground";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "index", label: "Index" },
  { id: "query-search", label: "Query + Search" },
  { id: "refine", label: "Refine" },
  { id: "playground", label: "Playground" },
];

// ---------------------------------------------------------------------------
// TabBar
// ---------------------------------------------------------------------------

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <div className="flex gap-0 border-b border-border bg-bg-elevated px-4">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
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
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({ onNewRetriever }: { onNewRetriever: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <p className="text-text-muted text-sm">
          Select a retriever to inspect its pipeline, or create a new one.
        </p>
        <button
          onClick={onNewRetriever}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent/90 text-bg-elevated transition-colors cursor-pointer"
        >
          Create New Retriever
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page (with Suspense boundary for useSearchParams)
// ---------------------------------------------------------------------------

export default function RetrieversPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-screen">
          <Header mode="retrievers" />
        </div>
      }
    >
      <RetrieversPageContent />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------

function RetrieversPageContent() {
  // --- KB selection (persisted in URL) ---
  const [selectedKbId, setSelectedKbId] = useKbFromUrl();

  // --- Retriever selection ---
  const [selectedRetrieverId, setSelectedRetrieverId] =
    useState<Id<"retrievers"> | null>(null);

  // --- Fetch selected retriever ---
  const selectedRetriever = useQuery(
    api.crud.retrievers.get,
    selectedRetrieverId ? { id: selectedRetrieverId } : "skip",
  );

  // --- All retrievers for playground ---
  const allRetrievers = useQuery(
    api.crud.retrievers.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );

  // --- Tab state ---
  const [activeTab, setActiveTab] = useState<TabId>("index");

  // --- Shared query state (persists across query-search and refine tabs) ---
  const [query, setQuery] = useState("");

  // --- Playground multi-select ---
  const [selectedRetrieverIds, setSelectedRetrieverIds] = useState<
    Set<Id<"retrievers">>
  >(new Set());

  // --- Wizard modal ---
  const [showWizard, setShowWizard] = useState(false);

  // --- Actions & mutations ---
  const createRetriever = useAction(api.retrieval.retrieverActions.create);
  const startIndexingAction = useAction(
    api.retrieval.retrieverActions.startIndexing,
  );

  const handleStartIndexing = useCallback(
    async (id: Id<"retrievers">) => {
      try {
        await startIndexingAction({ retrieverId: id });
      } catch (err) {
        console.error("Failed to start indexing:", err);
      }
    },
    [startIndexingAction],
  );

  // --- Handlers ---

  const handleToggleRetrieverCheck = useCallback((id: Id<"retrievers">) => {
    setSelectedRetrieverIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleRetrieverSelect = useCallback(
    (id: Id<"retrievers"> | null) => {
      setSelectedRetrieverId(id);
    },
    [],
  );

  const handleKbChange = useCallback(
    (kbId: Id<"knowledgeBases"> | null) => {
      setSelectedKbId(kbId);
      // Clear retriever selection when KB changes
      setSelectedRetrieverId(null);
      setSelectedRetrieverIds(new Set());
    },
    [setSelectedKbId],
  );

  return (
    <div className="flex flex-col h-screen">
      <Header mode="retrievers" kbId={selectedKbId} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <RetrieverSidebar
          selectedKbId={selectedKbId}
          onKbChange={handleKbChange}
          selectedRetrieverId={selectedRetrieverId}
          onRetrieverSelect={handleRetrieverSelect}
          onNewRetriever={() => setShowWizard(true)}
          isPlaygroundMode={activeTab === "playground"}
          selectedRetrieverIds={selectedRetrieverIds}
          onToggleRetrieverCheck={handleToggleRetrieverCheck}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedRetrieverId && selectedRetriever ? (
            <>
              {/* Tab bar */}
              <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

              {/* Tab content */}
              <div className="flex-1 overflow-auto">
                {activeTab === "index" && (
                  <IndexTab
                    retriever={selectedRetriever}
                    onStartIndexing={() =>
                      handleStartIndexing(selectedRetriever._id)
                    }
                  />
                )}
                {activeTab === "query-search" && (
                  <QuerySearchTab
                    retriever={selectedRetriever}
                    query={query}
                    onQueryChange={setQuery}
                  />
                )}
                {activeTab === "refine" && (
                  <RefineTab
                    retriever={selectedRetriever}
                    query={query}
                    onQueryChange={setQuery}
                  />
                )}
                {activeTab === "playground" && (
                  <PlaygroundTab
                    selectedRetrieverIds={selectedRetrieverIds}
                    retrievers={allRetrievers ?? []}
                  />
                )}
              </div>
            </>
          ) : selectedRetrieverId ? (
            /* Loading state — retriever selected but data still loading */
            <div className="flex-1 flex flex-col overflow-hidden">
              <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
              <div className="flex-1 flex items-center justify-center">
                <div className="flex items-center gap-2 text-text-dim text-sm">
                  <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  Loading...
                </div>
              </div>
            </div>
          ) : (
            <EmptyState onNewRetriever={() => setShowWizard(true)} />
          )}
        </div>

        {/* Wizard modal */}
        {showWizard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="w-[720px] h-[85vh] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col">
              <RetrieverWizard
                onCreate={async (config, name) => {
                  if (!selectedKbId) return;
                  try {
                    const pConfig: PipelineConfig = {
                      name,
                      index: {
                        strategy: (config.index?.strategy ?? "plain") as "plain",
                        chunkSize: config.index?.chunkSize as
                          | number
                          | undefined,
                        chunkOverlap: config.index?.chunkOverlap as
                          | number
                          | undefined,
                      },
                      search: config.search as PipelineConfig["search"],
                      query: config.query as PipelineConfig["query"],
                      refinement:
                        config.refinement as PipelineConfig["refinement"],
                      k: config.k,
                    };
                    const result = await createRetriever({
                      kbId: selectedKbId,
                      retrieverConfig: pConfig,
                    });
                    // Select the newly created (or existing duplicate) retriever
                    setSelectedRetrieverId(result.retrieverId);
                    setShowWizard(false);
                  } catch (err) {
                    console.error("Failed to create retriever:", err);
                  }
                }}
                onClose={() => setShowWizard(false)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
