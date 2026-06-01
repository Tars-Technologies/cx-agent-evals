"use client";

import { use, useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { Spinner } from "@/components/shell/Spinner";
import { ErrorToast } from "@/components/shell/ErrorToast";
import { kbSidebar } from "@/components/shell/sidebars";
import { useKbBreadcrumb } from "@/lib/useKbBreadcrumb";
import { QuestionList } from "@/components/QuestionList";
import { DocumentViewer } from "@/components/DocumentViewer";
import { DeleteDatasetModal } from "@/components/DeleteDatasetModal";
import { EditQuestionModal } from "@/components/EditQuestionModal";
import { ResizablePanel } from "@/components/ResizablePanel";
import { DocumentInfo, GeneratedQuestion } from "@/lib/types";

export default function KbDatasetDetailPage({
  params,
}: {
  params: Promise<{ id: string; datasetId: string }>;
}) {
  const { id, datasetId: datasetIdParam } = use(params);
  const kbId = id as Id<"knowledgeBases">;
  const datasetId = datasetIdParam as Id<"datasets">;
  const router = useRouter();

  const dataset = useQuery(api.crud.datasets.get, { id: datasetId });
  const { labelOverrides: kbLabelOverrides } = useKbBreadcrumb(kbId);

  const browseQuestions = useQuery(api.crud.questions.byDataset, { datasetId });

  const activeJob = useQuery(api.generation.orchestration.getActiveJob, {});
  const isActivelyGenerating = activeJob?.datasetId === datasetId;

  const deleteDataset = useMutation(api.crud.datasets.deleteDataset);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(null);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(null);

  const selectedDocData = useQuery(
    api.crud.documents.get,
    selectedDocId ? { id: selectedDocId } : "skip",
  );

  const questions: GeneratedQuestion[] = (browseQuestions ?? []).map((q) => ({
    docId: q.sourceDocId,
    query: q.queryText,
    relevantSpans: q.relevantSpans,
    source: q.source,
  }));

  const selectedQ = selectedQuestion !== null ? questions[selectedQuestion] : null;

  const selectedQDocIdList = useMemo(() => {
    if (!selectedQ) return [];
    const set = new Set<string>([selectedQ.docId]);
    if (selectedQ.relevantSpans) {
      for (const s of selectedQ.relevantSpans) set.add(s.docId);
    }
    return [...set];
  }, [selectedQ]);

  const resolvedDocs = useQuery(
    api.crud.documents.getDocsByDocIds,
    selectedQDocIdList.length > 0 ? { kbId, docIds: selectedQDocIdList } : "skip",
  );

  const docIdToConvexId = useMemo(() => {
    const map = new Map<string, Id<"documents">>();
    for (const d of resolvedDocs ?? []) map.set(d.docId, d._id);
    return map;
  }, [resolvedDocs]);

  const prevSelectedQuestion = useRef<number | null>(null);
  useEffect(() => {
    if (selectedQuestion === prevSelectedQuestion.current) return;
    if (!selectedQ) return;
    const sourceId = docIdToConvexId.get(selectedQ.docId);
    if (!sourceId) return;
    prevSelectedQuestion.current = selectedQuestion;
    setSelectedDocId(sourceId);
  }, [selectedQuestion, selectedQ, docIdToConvexId]);

  const selectedDoc: DocumentInfo | null = selectedDocData
    ? {
        id: selectedDocData.docId,
        content: selectedDocData.content,
        contentLength: selectedDocData.contentLength,
      }
    : null;

  const selectedQDocIds = (() => {
    if (!selectedQ) return undefined;
    const ids = new Set<string>();
    ids.add(selectedQ.docId);
    if (selectedQ.relevantSpans) {
      for (const s of selectedQ.relevantSpans) ids.add(s.docId);
    }
    return ids.size > 1 ? [...ids] : undefined;
  })();

  function handleNavigateDoc(docId: string) {
    const id = docIdToConvexId.get(docId);
    if (id) setSelectedDocId(id);
  }

  async function handleDeleteDataset() {
    if (!dataset) return;
    try {
      await deleteDataset({ id: dataset._id });
      setDeleteOpen(false);
      router.push(`/kb/${kbId}/evaluate/datasets`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete dataset");
    }
  }

  const breadcrumbLabelOverrides = dataset
    ? { ...(kbLabelOverrides ?? {}), [datasetId]: dataset.name }
    : kbLabelOverrides;

  const phaseStatus = isActivelyGenerating && activeJob
    ? activeJob.phase === "preparing"
      ? "Phase: Preparing │ Docs: — │ Questions: —"
      : `Phase: Generating │ ${activeJob.processedItems} of ${activeJob.totalItems} docs │ ${activeJob.questionsGenerated ?? 0} questions`
    : null;

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
            {dataset?.name ?? "Loading…"}
          </h2>
          {dataset && (
            <p className="text-[11px] text-text-dim mt-0.5">
              {dataset.questionCount} questions · strategy: {dataset.strategy}
            </p>
          )}
        </div>
        {dataset && (
          <button
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
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

      <div className="flex border border-border rounded-lg overflow-hidden bg-bg-elevated flex-1 min-h-0">
        {browseQuestions === undefined ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner label="Loading questions…" />
          </div>
        ) : questions.length === 0 && !isActivelyGenerating ? (
          <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
            No questions in this dataset
          </div>
        ) : (
          <>
            <ResizablePanel storageKey="kb-dataset-questions" defaultWidth={320} minWidth={200} maxWidth={600}>
              <div className="h-full border-r border-border bg-bg">
                <QuestionList
                  questions={questions}
                  selectedIndex={selectedQuestion}
                  onSelect={setSelectedQuestion}
                  onEdit={(idx) => setEditingQuestionIndex(idx)}
                  generating={isActivelyGenerating}
                  totalDone={questions.length}
                  phaseStatus={phaseStatus}
                  realWorldCount={
                    !isActivelyGenerating
                      ? questions.filter((q) => q.source === "real-world").length
                      : undefined
                  }
                />
              </div>
            </ResizablePanel>
            <div className="flex-1 min-w-0 bg-bg overflow-hidden">
              <DocumentViewer
                doc={selectedDoc}
                question={selectedQ}
                allDocIds={selectedQDocIds}
                onNavigateDoc={handleNavigateDoc}
              />
            </div>
          </>
        )}
      </div>

      {deleteOpen && dataset && (
        <DeleteDatasetModal
          datasetName={dataset.name}
          questionCount={dataset.questionCount}
          strategy={dataset.strategy}
          onConfirm={handleDeleteDataset}
          onClose={() => {
            setDeleteOpen(false);
            setDeleteError(null);
          }}
        />
      )}

      {editingQuestionIndex !== null && browseQuestions?.[editingQuestionIndex] && (
        <EditQuestionModal
          question={{
            _id: browseQuestions[editingQuestionIndex]._id,
            queryText: browseQuestions[editingQuestionIndex].queryText,
            sourceDocId: browseQuestions[editingQuestionIndex].sourceDocId,
            relevantSpans: browseQuestions[editingQuestionIndex].relevantSpans,
          }}
          kbId={kbId}
          onClose={() => setEditingQuestionIndex(null)}
        />
      )}

      {deleteError && <ErrorToast message={deleteError} onDismiss={() => setDeleteError(null)} />}
    </EntityDetailLayout>
  );
}
