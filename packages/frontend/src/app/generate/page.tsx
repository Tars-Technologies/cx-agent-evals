"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useKbFromUrl } from "@/lib/useKbFromUrl";
import { KBDropdown } from "@/components/KBDropdown";
import { QuestionList } from "@/components/QuestionList";
import { DocumentViewer } from "@/components/DocumentViewer";
import { GenerationWizard } from "@/components/GenerationWizard";
import { DeleteDatasetModal } from "@/components/DeleteDatasetModal";
import { GenerationBanner } from "@/components/GenerationBanner";
import { ResizablePanel } from "@/components/ResizablePanel";
import { DocumentInfo, GeneratedQuestion } from "@/lib/types";

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

  // Documents in the selected KB
  const documentsData = useQuery(
    api.crud.documents.listByKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );

  // Job status (reactive — updates as generation progresses)
  const job = useQuery(api.generation.orchestration.getJob, jobId ? { jobId } : "skip");

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

  // Wizard modal state
  const [showWizardModal, setShowWizardModal] = useState(false);

  // Ref to prevent effects from overriding explicit user choices
  const hasRestoredJob = useRef(false);

  // Reset browse selection and job tracking when KB changes
  useEffect(() => {
    setBrowseDatasetId(null);
    hasRestoredJob.current = false;
  }, [selectedKbId]);

  // Auto-select first dataset when KB changes and datasets load
  useEffect(() => {
    if (kbDatasets && kbDatasets.length > 0 && !browseDatasetId) {
      setBrowseDatasetId(kbDatasets[0]._id);
    }
  }, [kbDatasets, browseDatasetId]);

  // Close wizard modal on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && showWizardModal) {
        setShowWizardModal(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showWizardModal]);

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
    source: q.source,
  }));

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

  // Phase status from generation job
  const phaseStatus = job?.phase
    ? job.phase === "preparing"
      ? "Phase: Preparing │ Docs: — │ Questions: —"
      : `Phase: Generating │ ${job.processedItems} of ${job.totalItems} docs │ ${job.questionsGenerated ?? 0} questions`
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
          source: q.source,
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
      ? activeJob.phase === "preparing"
        ? "Phase: Preparing │ Docs: — │ Questions: —"
        : `Phase: Generating │ ${activeJob.processedItems} of ${activeJob.totalItems} docs │ ${activeJob.questionsGenerated ?? 0} questions`
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
            questionsGenerated={activeJob.questionsGenerated ?? 0}
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

      {/* ── Controls Bar ── */}
      <div className="border-b border-border bg-bg-elevated px-6 py-3">
        <div className="flex items-center gap-4">
          {/* KB dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
              KB
            </label>
            <KBDropdown selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
          </div>

          {/* Dataset dropdown */}
          {selectedKbId && kbDatasets !== undefined && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
                Dataset
              </label>
              <select
                value={browseDatasetId ?? ""}
                onChange={(e) => {
                  if (e.target.value) {
                    const id = e.target.value as Id<"datasets">;
                    setBrowseDatasetId(id);
                    setSelectedQuestion(null);
                    setSelectedDocId(null);
                    setMode("browse");
                  }
                }}
                className="max-w-xs bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none"
              >
                <option value="">Select a dataset...</option>
                {kbDatasets.map((ds) => (
                  <option key={ds._id} value={ds._id}>
                    {ds.name} ({ds.questionCount} Qs{activeJob?.datasetId === ds._id ? " — generating" : ""})
                  </option>
                ))}
              </select>
              {browseDatasetId && (
                <button
                  onClick={() => {
                    const ds = kbDatasets?.find((d) => d._id === browseDatasetId);
                    if (ds) {
                      setDeleteTarget({
                        id: ds._id,
                        name: ds.name,
                        questionCount: ds.questionCount,
                        strategy: ds.strategy,
                      });
                      setDeleteError(null);
                    }
                  }}
                  className="p-1.5 text-text-dim hover:text-red-400 transition-colors"
                  title="Delete dataset"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* New Generation button */}
          {selectedKbId && (
            <button
              onClick={() => setShowWizardModal(true)}
              disabled={!hasDocuments || !!activeJob}
              title={
                !hasDocuments
                  ? "Upload documents before generating"
                  : activeJob
                    ? "Only one generation at a time"
                    : undefined
              }
              className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + New Generation
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden max-w-full">
        {displayQuestions.length === 0 && !displayGenerating ? (
          <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
            {selectedKbId
              ? browseDatasetId
                ? "No questions in this dataset"
                : "Select a dataset to view questions"
              : "Select a knowledge base to get started"}
          </div>
        ) : (
          <>
            {/* Left: question list (resizable) */}
            <ResizablePanel storageKey="generate-questions" defaultWidth={320} minWidth={200} maxWidth={600}>
              <div className="h-full border-r border-border bg-bg">
                <QuestionList
                  questions={displayQuestions}
                  selectedIndex={selectedQuestion}
                  onSelect={setSelectedQuestion}
                  generating={displayGenerating}
                  totalDone={displayTotalDone}
                  phaseStatus={displayPhaseStatus}
                  realWorldCount={
                    !displayGenerating
                      ? displayQuestions.filter((q) => q.source === "real-world").length
                      : undefined
                  }
                />
              </div>
            </ResizablePanel>

            {/* Right: document viewer */}
            <div className="flex-1 min-w-0 bg-bg overflow-hidden">
              <DocumentViewer doc={selectedDoc} question={selectedQ} />
            </div>
          </>
        )}
      </div>

      {/* Generation Wizard Modal */}
      {showWizardModal && selectedKbId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowWizardModal(false)} />
          <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto animate-fade-in">
            <GenerationWizard
              kbId={selectedKbId}
              documents={(documentsData ?? []).map((d) => ({
                _id: d._id as string,
                docId: d.docId,
                title: d.title,
                priority: d.priority ?? 3,
              }))}
              generating={generating}
              disabledReason={activeJob ? "Only one generation at a time" : undefined}
              onGenerated={(dsId, jId) => {
                setDatasetId(dsId);
                setJobId(jId);
                setBrowseDatasetId(dsId);
                setMode("browse");
                setShowWizardModal(false);
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

      {/* Generation error toast */}
      {(genError || job?.error) && (
        <div className="fixed bottom-4 right-4 z-[70] max-w-md bg-bg-elevated border border-red-500/30 rounded-lg p-3 shadow-2xl animate-fade-in">
          <p className="text-xs text-red-400">{genError || job?.error}</p>
          <button
            onClick={() => setGenError(null)}
            className="text-[10px] text-text-dim mt-1 hover:text-text"
          >
            Dismiss
          </button>
        </div>
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
