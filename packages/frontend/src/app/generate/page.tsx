"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useKbFromUrl } from "@/lib/useKbFromUrl";
import { KBDropdown } from "@/components/KBDropdown";
import { GenerateConfig } from "@/components/GenerateConfig";
import { QuestionList } from "@/components/QuestionList";
import { DocumentViewer } from "@/components/DocumentViewer";
import { DimensionWizard } from "@/components/DimensionWizard";
import { RealWorldQuestionsModal } from "@/components/RealWorldQuestionsModal";
import { DeleteDatasetModal } from "@/components/DeleteDatasetModal";
import { GenerationBanner } from "@/components/GenerationBanner";
import { StrategyType, Dimension, DocumentInfo, GeneratedQuestion } from "@/lib/types";

export default function GeneratePage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen"><Header mode="generate" /></div>}>
      <GeneratePageContent />
    </Suspense>
  );
}

function GeneratePageContent() {
  // KB selection
  const [selectedKbId, setSelectedKbId] = useKbFromUrl();

  // Generation tracking
  const [datasetId, setDatasetId] = useState<Id<"datasets"> | null>(null);
  const [jobId, setJobId] = useState<Id<"generationJobs"> | null>(null);

  // Questions from Convex (reactive)
  const questionsData = useQuery(
    api.crud.questions.byDataset,
    datasetId ? { datasetId } : "skip",
  );

  // Documents in the selected KB (paginated to avoid 16MB read limit)
  const {
    results: documentsData,
    status: docPaginationStatus,
    loadMore: loadMoreDocs,
  } = usePaginatedQuery(
    api.crud.documents.listByKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
    { initialNumItems: 100 },
  );

  // Job status (reactive — updates as generation progresses)
  const job = useQuery(api.generation.orchestration.getJob, jobId ? { jobId } : "skip");

  // Dataset info
  const dataset = useQuery(api.crud.datasets.get, datasetId ? { id: datasetId } : "skip");

  const startGeneration = useMutation(api.generation.orchestration.startGeneration);
  const deleteDataset = useMutation(api.crud.datasets.deleteDataset);

  // Datasets for selected KB
  const kbDatasets = useQuery(
    api.crud.datasets.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );

  // Active job detection (org-wide, no kbId filter — we want to know about any active job)
  const activeJob = useQuery(api.generation.orchestration.getActiveJob, {});

  // Look up KB name for the active job's banner
  const activeJobKb = useQuery(
    api.crud.knowledgeBases.get,
    activeJob ? { id: activeJob.kbId } : "skip",
  );

  // Mode: "browse" (viewing existing datasets) or "generate" (creating new)
  type PageMode = "browse" | "generate";
  const [mode, setMode] = useState<PageMode>("browse");

  // Selected dataset for browsing
  const [browseDatasetId, setBrowseDatasetId] = useState<Id<"datasets"> | null>(null);

  // Questions for browsed dataset
  const browseQuestions = useQuery(
    api.crud.questions.byDataset,
    browseDatasetId ? { datasetId: browseDatasetId } : "skip",
  );

  // Refs to prevent effects from overriding explicit user mode choices
  const initialModeSet = useRef(false);
  const hasRestoredJob = useRef(false);

  // Set initial mode based on whether datasets exist.
  // Only auto-sets mode once per KB — after that, user controls mode explicitly.
  useEffect(() => {
    if (kbDatasets === undefined) return;
    if (!initialModeSet.current) {
      initialModeSet.current = true;
      setMode(kbDatasets.length > 0 ? "browse" : "generate");
    } else if (kbDatasets.length === 0) {
      // Always switch to generate if all datasets are deleted
      setMode("generate");
    }
  }, [kbDatasets]);

  // Reset browse selection and mode tracking when KB changes
  useEffect(() => {
    setBrowseDatasetId(null);
    initialModeSet.current = false;
    hasRestoredJob.current = false;
  }, [selectedKbId]);

  // Auto-restore active job state once when returning to the page
  useEffect(() => {
    if (activeJob && !jobId && !hasRestoredJob.current) {
      hasRestoredJob.current = true;
      setJobId(activeJob._id);
      setDatasetId(activeJob.datasetId);
      setBrowseDatasetId(activeJob.datasetId);
      setMode("browse");
    }
  }, [activeJob, jobId]);

  // UI state
  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"datasets">;
    name: string;
    questionCount: number;
    strategy: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Strategy state
  const [strategy, setStrategy] = useState<StrategyType>("simple");
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(30);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitialStep, setWizardInitialStep] = useState(1);
  const [realWorldQuestions, setRealWorldQuestions] = useState<string[]>([]);
  const [realWorldModalOpen, setRealWorldModalOpen] = useState(false);

  // Selected document for viewing
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(null);
  const selectedDocData = useQuery(
    api.crud.documents.get,
    selectedDocId ? { id: selectedDocId } : "skip",
  );

  // Derive generating state: either from local job or org-wide active job
  const generating = job?.status === "pending" || job?.status === "running" || !!activeJob;

  // Convert Convex questions to component format
  const questions: GeneratedQuestion[] = (questionsData ?? []).map((q) => ({
    docId: q.sourceDocId,
    query: q.queryText,
    relevantSpans: q.relevantSpans,
  }));

  // Convert Convex documents to DocumentInfo format
  const documents: DocumentInfo[] = (documentsData ?? []).map((d) => ({
    id: d.docId,
    content: "", // Content loaded on demand via selectedDocData
    contentLength: d.contentLength,
  }));

  // Load saved configs from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rag-eval:dimension-config");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.dimensions) && parsed.dimensions.length > 0) {
          setDimensions(parsed.dimensions);
          setTotalQuestions(parsed.totalQuestions ?? 50);
          setStrategy("dimension-driven");
        }
      }
    } catch {
      // Ignore corrupted localStorage
    }
    try {
      const saved = localStorage.getItem("rag-eval:real-world-questions");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRealWorldQuestions(parsed);
        }
      }
    } catch {
      // Ignore corrupted localStorage
    }
  }, []);

  async function handleDeleteDataset() {
    if (!deleteTarget) return;
    try {
      await deleteDataset({ id: deleteTarget.id });
      setDeleteTarget(null);
      setDeleteError(null);
      // Clear browse selection if deleted dataset was selected
      if (browseDatasetId === deleteTarget.id) {
        setBrowseDatasetId(null);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete dataset");
    }
  }

  function handleReset() {
    setDatasetId(null);
    setJobId(null);
    setSelectedQuestion(null);
    setGenError(null);
    setSelectedDocId(null);
    setBrowseDatasetId(null);
    if (kbDatasets && kbDatasets.length > 0) {
      setMode("browse");
    }
  }

  function handleOpenWizard() {
    if (dimensions.length > 0) {
      setWizardInitialStep(2);
    } else {
      setWizardInitialStep(1);
    }
    setWizardOpen(true);
  }

  function handleWizardSave(dims: Dimension[], total: number) {
    setDimensions(dims);
    setTotalQuestions(total);
    setWizardOpen(false);
    try {
      localStorage.setItem(
        "rag-eval:dimension-config",
        JSON.stringify({ dimensions: dims, totalQuestions: total }),
      );
    } catch {
      // localStorage full or unavailable
    }
  }

  function handleRealWorldSave(qs: string[]) {
    setRealWorldQuestions(qs);
    setRealWorldModalOpen(false);
    try {
      localStorage.setItem("rag-eval:real-world-questions", JSON.stringify(qs));
    } catch {
      // localStorage full or unavailable
    }
  }

  async function handleGenerate() {
    if (!selectedKbId || generating) return;

    setGenError(null);
    setSelectedQuestion(null);
    setSelectedDocId(null);

    const strategyConfig: Record<string, unknown> = {};

    if (strategy === "simple") {
      strategyConfig.totalQuestions = totalQuestions;
    } else if (strategy === "dimension-driven") {
      strategyConfig.dimensions = dimensions;
      strategyConfig.totalQuestions = totalQuestions;
    } else if (strategy === "real-world-grounded") {
      strategyConfig.questions = realWorldQuestions;
      strategyConfig.totalSyntheticQuestions = totalQuestions;
    }

    try {
      const result = await startGeneration({
        kbId: selectedKbId,
        name: `${strategy}-${Date.now()}`,
        strategy,
        strategyConfig,
      });

      setDatasetId(result.datasetId);
      setJobId(result.jobId);
      setBrowseDatasetId(result.datasetId);
      setMode("browse");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to start generation");
    }
  }

  // Phase status from generation job
  const phaseStatus = job?.phase
    ? `${job.phase}... (${job.processedItems}/${job.totalItems})`
    : null;
  const totalDone = job?.status === "completed" || job?.status === "completed_with_errors"
    ? (questions.length || null)
    : null;

  // Resolve which questions + state to display based on mode
  const displayQuestions: GeneratedQuestion[] =
    mode === "browse"
      ? (browseQuestions ?? []).map((q) => ({
          docId: q.sourceDocId,
          query: q.queryText,
          relevantSpans: q.relevantSpans,
        }))
      : questions;

  // Show generating state in center pane when browsing the actively generating dataset
  const browsingActiveDataset = mode === "browse" && activeJob && browseDatasetId === activeJob.datasetId;
  const displayGenerating = (mode === "generate" && generating) || !!browsingActiveDataset;
  const displayTotalDone = mode === "browse"
    ? browseQuestions?.length ?? null
    : totalDone;
  const displayPhaseStatus = mode === "generate"
    ? phaseStatus
    : browsingActiveDataset
      ? `${activeJob.phase}... (${activeJob.processedItems}/${activeJob.totalItems})`
      : null;

  // When a question is selected, load its source document
  const selectedQ = selectedQuestion !== null ? displayQuestions[selectedQuestion] : null;
  useEffect(() => {
    if (selectedQ && documentsData) {
      const doc = documentsData.find((d) => d.docId === selectedQ.docId);
      if (doc) {
        setSelectedDocId(doc._id);
      }
    }
  }, [selectedQ, documentsData]);

  // Build doc info for DocumentViewer
  const selectedDoc: DocumentInfo | null = selectedDocData
    ? {
        id: selectedDocData.docId,
        content: selectedDocData.content,
        contentLength: selectedDocData.contentLength,
      }
    : null;

  // When generation completes, switch to browsing the new dataset
  useEffect(() => {
    if (
      mode === "generate" &&
      datasetId &&
      (job?.status === "completed" || job?.status === "completed_with_errors")
    ) {
      setMode("browse");
      setBrowseDatasetId(datasetId);
    }
  }, [job?.status, datasetId, mode]);

  const hasDocuments = (documentsData ?? []).length > 0;

  return (
    <div className="flex flex-col h-screen">
      <Header mode="generate" kbId={selectedKbId} />

        {/* Generation Banner — shown when any job is active */}
        {activeJob && (
          <GenerationBanner
            strategy={activeJob.strategy}
            kbName={activeJobKb?.name ?? "..."}
            phase={activeJob.phase}
            processedItems={activeJob.processedItems}
            totalItems={activeJob.totalItems}
            onView={() => {
              // Switch to the KB and dataset of the active job
              if (activeJob.kbId !== selectedKbId) {
                setSelectedKbId(activeJob.kbId);
              }
              setBrowseDatasetId(activeJob.datasetId);
              setDatasetId(activeJob.datasetId);
              setJobId(activeJob._id);
            }}
          />
        )}

      <div className="flex flex-1 overflow-hidden max-w-full">
        {/* Left sidebar: KB selector + config */}
        <div className="w-[360px] flex-shrink-0 border-r border-border bg-bg-elevated overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* KB Selector */}
            <div className="border border-border rounded-lg bg-bg">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Knowledge Base
              </div>
              <div className="p-4">
                <KBDropdown selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
              </div>
            </div>

            {/* Dataset section — appears after KB selected */}
            {selectedKbId && kbDatasets !== undefined && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-xs text-text-dim uppercase tracking-wider">
                    Datasets ({kbDatasets.length})
                  </span>
                  {kbDatasets.length > 0 && (
                    <button
                      onClick={() => {
                        if (mode === "generate") {
                          setMode("browse");
                        } else {
                          // Clear stale job state so the auto-switch-to-browse effect doesn't fire
                          setDatasetId(null);
                          setJobId(null);
                          setMode("generate");
                          setBrowseDatasetId(null);
                        }
                      }}
                      className={mode === "generate"
                        ? "text-[11px] text-accent hover:text-accent/80 transition-colors"
                        : "px-2.5 py-1 text-[11px] font-medium bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
                      }
                    >
                      {mode === "generate" ? "View Datasets" : "+ New Dataset"}
                    </button>
                  )}
                </div>

                {mode === "browse" && kbDatasets.length > 0 && (
                  <div className="p-4 space-y-1 max-h-64 overflow-y-auto">
                    {kbDatasets.map((ds) => (
                      <div key={ds._id} className="relative group">
                        <button
                          onClick={() => {
                            setBrowseDatasetId(ds._id);
                            setSelectedQuestion(null);
                            setSelectedDocId(null);
                          }}
                          className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                            browseDatasetId === ds._id
                              ? "bg-accent/10 border border-accent/30 text-text"
                              : "hover:bg-bg-hover border border-transparent text-text-muted"
                          }`}
                        >
                          <div className="font-medium truncate pr-6">{ds.name}</div>
                          <div className="flex gap-2 text-[10px] text-text-dim mt-0.5">
                            {activeJob?.datasetId === ds._id ? (
                              <span className="flex items-center gap-1.5 text-accent">
                                <span className="w-1 h-1 rounded-full bg-accent animate-pulse-dot" />
                                Generating... ({activeJob.processedItems}/{activeJob.totalItems})
                              </span>
                            ) : (
                              <>
                                <span>{ds.questionCount} questions</span>
                                <span>{ds.strategy}</span>
                              </>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({
                              id: ds._id,
                              name: ds.name,
                              questionCount: ds.questionCount,
                              strategy: ds.strategy,
                            });
                            setDeleteError(null);
                          }}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 transition-all p-1"
                          title="Delete dataset"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {hasDocuments && mode === "generate" && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Generation Config
                </div>
                <div className="p-4">
                  <GenerateConfig
                    onGenerate={handleGenerate}
                    disabled={!hasDocuments}
                    generating={generating}
                    disabledReason={activeJob ? "Only one generation at a time" : undefined}
                    strategy={strategy}
                    onStrategyChange={setStrategy}
                    dimensions={dimensions}
                    totalQuestions={totalQuestions}
                    onTotalQuestionsChange={setTotalQuestions}
                    onOpenWizard={handleOpenWizard}
                    realWorldQuestions={realWorldQuestions}
                    onOpenRealWorldModal={() => setRealWorldModalOpen(true)}
                    numDocs={documentsData?.length ?? 0}
                  />
                </div>
              </div>
            )}

            {genError && (
              <div className="p-3 rounded border border-error/30 bg-error/5 animate-fade-in">
                <p className="text-xs text-error">{genError}</p>
              </div>
            )}

            {job?.error && (
              <div className="p-3 rounded border border-error/30 bg-error/5 animate-fade-in">
                <p className="text-xs text-error">{job.error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Center: question list */}
        {(displayQuestions.length > 0 || displayGenerating) && (
          <div className="w-80 flex-shrink-0 border-r border-border bg-bg">
            <QuestionList
              questions={displayQuestions}
              selectedIndex={selectedQuestion}
              onSelect={setSelectedQuestion}
              generating={displayGenerating}
              totalDone={displayTotalDone}
              phaseStatus={displayPhaseStatus}
            />
          </div>
        )}

        {/* Right: document viewer */}
        <div className="flex-1 min-w-0 bg-bg overflow-hidden">
          <DocumentViewer doc={selectedDoc} question={selectedQ} />
        </div>
      </div>

      {/* Dimension Wizard Modal */}
      {wizardOpen && (
        <DimensionWizard
          initialDimensions={dimensions.length > 0 ? dimensions : undefined}
          initialTotalQuestions={totalQuestions}
          initialStep={wizardInitialStep}
          onSave={handleWizardSave}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {/* Real-World Questions Modal */}
      {realWorldModalOpen && (
        <RealWorldQuestionsModal
          initialQuestions={realWorldQuestions}
          onSave={handleRealWorldSave}
          onClose={() => setRealWorldModalOpen(false)}
        />
      )}

      {/* Delete Dataset Modal */}
      {deleteTarget && (
        <DeleteDatasetModal
          datasetName={deleteTarget.name}
          questionCount={deleteTarget.questionCount}
          strategy={deleteTarget.strategy}
          onConfirm={handleDeleteDataset}
          onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
        />
      )}

      {/* Delete error toast */}
      {deleteError && (
        <div className="fixed bottom-4 right-4 z-[70] max-w-md bg-bg-elevated border border-red-500/30 rounded-lg p-3 shadow-2xl animate-fade-in">
          <p className="text-xs text-red-400">{deleteError}</p>
          <button
            onClick={() => setDeleteError(null)}
            className="text-[10px] text-text-dim mt-1 hover:text-text"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

