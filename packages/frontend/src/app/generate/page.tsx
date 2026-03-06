"use client";

import { Suspense, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useKbFromUrl } from "@/lib/useKbFromUrl";
import { KBSelector } from "@/components/KBSelector";
import { GenerateConfig, GenerateSettings } from "@/components/GenerateConfig";
import { QuestionList } from "@/components/QuestionList";
import { DocumentViewer } from "@/components/DocumentViewer";
import { DimensionWizard } from "@/components/DimensionWizard";
import { RealWorldQuestionsModal } from "@/components/RealWorldQuestionsModal";
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

  // Documents in the selected KB
  const documentsData = useQuery(
    api.crud.documents.listByKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );

  // Job status (reactive — updates as generation progresses)
  const job = useQuery(api.generation.orchestration.getJob, jobId ? { jobId } : "skip");

  // Dataset info
  const dataset = useQuery(api.crud.datasets.get, datasetId ? { id: datasetId } : "skip");

  const startGeneration = useMutation(api.generation.orchestration.startGeneration);

  // Datasets for selected KB
  const kbDatasets = useQuery(
    api.crud.datasets.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
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

  // Auto-switch to generate mode when no datasets exist
  useEffect(() => {
    if (kbDatasets !== undefined && kbDatasets.length === 0) {
      setMode("generate");
    }
  }, [kbDatasets]);

  // Reset browse selection when KB changes
  useEffect(() => {
    setBrowseDatasetId(null);
    setMode(kbDatasets && kbDatasets.length > 0 ? "browse" : "generate");
  }, [selectedKbId]);

  // UI state
  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [settings, setSettings] = useState<GenerateSettings>({
    questionsPerDoc: 10,
  });

  // Strategy state
  const [strategy, setStrategy] = useState<StrategyType>("simple");
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(50);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitialStep, setWizardInitialStep] = useState(1);
  const [realWorldQuestions, setRealWorldQuestions] = useState<string[]>([]);
  const [totalSyntheticQuestions, setTotalSyntheticQuestions] = useState(50);
  const [realWorldModalOpen, setRealWorldModalOpen] = useState(false);

  // Selected document for viewing
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(null);
  const selectedDocData = useQuery(
    api.crud.documents.get,
    selectedDocId ? { id: selectedDocId } : "skip",
  );

  // Derive generating state from job
  const generating = job?.status === "pending" || job?.status === "running";

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
      strategyConfig.queriesPerDoc = settings.questionsPerDoc;
    } else if (strategy === "dimension-driven") {
      strategyConfig.dimensions = dimensions;
      strategyConfig.totalQuestions = totalQuestions;
    } else if (strategy === "real-world-grounded") {
      strategyConfig.questions = realWorldQuestions;
      strategyConfig.totalSyntheticQuestions = totalSyntheticQuestions;
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

  const displayGenerating = mode === "generate" && generating;
  const displayTotalDone = mode === "browse"
    ? browseQuestions?.length ?? null
    : totalDone;
  const displayPhaseStatus = mode === "generate" ? phaseStatus : null;

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
      <Header mode="generate" kbId={selectedKbId} onReset={handleReset} />

      <div className="flex flex-1 overflow-hidden max-w-full">
        {/* Left sidebar: KB selector + config */}
        <div className="w-80 flex-shrink-0 border-r border-border bg-bg-elevated overflow-y-auto">
          <div className="p-4 space-y-6">
            <KBSelector selectedKbId={selectedKbId} onSelect={setSelectedKbId} />

            {/* Dataset section — appears after KB selected */}
            {selectedKbId && kbDatasets !== undefined && (
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted uppercase tracking-wide">
                    Datasets ({kbDatasets.length})
                  </span>
                  {kbDatasets.length > 0 && (
                    <button
                      onClick={() => {
                        if (mode === "generate") {
                          setMode("browse");
                        } else {
                          setMode("generate");
                          setBrowseDatasetId(null);
                        }
                      }}
                      className="text-[11px] text-accent hover:text-accent/80 transition-colors"
                    >
                      {mode === "generate" ? "View Datasets" : "+ New Dataset"}
                    </button>
                  )}
                </div>

                {mode === "browse" && kbDatasets.length > 0 && (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {kbDatasets.map((ds) => (
                      <button
                        key={ds._id}
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
                        <div className="font-medium truncate">{ds.name}</div>
                        <div className="flex gap-2 text-[10px] text-text-dim mt-0.5">
                          <span>{ds.questionCount} questions</span>
                          <span>{ds.strategy}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {hasDocuments && mode === "generate" && (
              <div className="pt-2 border-t border-border">
                <GenerateConfig
                  settings={settings}
                  onChange={setSettings}
                  onGenerate={handleGenerate}
                  disabled={!hasDocuments}
                  generating={generating}
                  strategy={strategy}
                  onStrategyChange={setStrategy}
                  dimensions={dimensions}
                  totalQuestions={totalQuestions}
                  onOpenWizard={handleOpenWizard}
                  realWorldQuestions={realWorldQuestions}
                  totalSyntheticQuestions={totalSyntheticQuestions}
                  onTotalSyntheticChange={setTotalSyntheticQuestions}
                  onOpenRealWorldModal={() => setRealWorldModalOpen(true)}
                />
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
    </div>
  );
}

