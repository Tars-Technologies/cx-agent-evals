"use client";

import { useState, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { FailureModeListPane } from "./FailureModeListPane";
import { FailureModeDetail } from "./FailureModeDetail";
import { UnmappedPane } from "./UnmappedPane";

interface FailureMode {
  _id: Id<"failureModes">;
  name: string;
  description: string;
  order: number;
}

interface Mapping {
  _id: string;
  failureModeId: Id<"failureModes">;
  questionId: Id<"questions">;
}

interface QuestionInfo {
  _id: Id<"questions">;
  queryText: string;
}

interface AnnotationInfo {
  questionId: string;
  rating: string;
  tags?: string[];
}

interface ReviewLayoutProps {
  failureModes: FailureMode[];
  mappings: Mapping[];
  questions: QuestionInfo[];
  annotations: AnnotationInfo[];
  experimentId: Id<"experiments">;
}

export function ReviewLayout({
  failureModes,
  mappings,
  questions,
  annotations,
  experimentId,
}: ReviewLayoutProps) {
  const [selectedId, setSelectedId] = useState<Id<"failureModes"> | null>(
    failureModes[0]?._id ?? null,
  );
  const unassignQuestion = useMutation(api.failureModes.crud.unassignQuestion);

  // Build lookup maps
  const questionMap = useMemo(
    () => new Map(questions.map((q) => [q._id, q])),
    [questions],
  );

  const annotationByQuestionId = useMemo(
    () => new Map(annotations.map((a) => [a.questionId, a])),
    [annotations],
  );

  // Mapping counts per failure mode
  const mappingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of mappings) {
      counts.set(m.failureModeId, (counts.get(m.failureModeId) ?? 0) + 1);
    }
    return counts;
  }, [mappings]);

  // Mapped questions for selected failure mode
  const mappedQuestions = useMemo(() => {
    if (!selectedId) return [];
    return mappings
      .filter((m) => m.failureModeId === selectedId)
      .map((m) => {
        const q = questionMap.get(m.questionId);
        const a = annotationByQuestionId.get(m.questionId as string);
        return {
          questionId: m.questionId,
          queryText: q?.queryText ?? "Unknown question",
          rating: a?.rating,
          tags: a?.tags,
        };
      });
  }, [selectedId, mappings, questionMap, annotationByQuestionId]);

  // Unmapped: annotated questions not in any mapping
  const unmappedQuestions = useMemo(() => {
    const mappedIds = new Set(mappings.map((m) => m.questionId as string));
    return annotations
      .filter((a) => !mappedIds.has(a.questionId))
      .map((a) => {
        const q = questionMap.get(a.questionId as Id<"questions">);
        return {
          questionId: a.questionId as Id<"questions">,
          queryText: q?.queryText ?? "Unknown question",
          rating: a.rating,
          tags: a.tags,
        };
      });
  }, [annotations, mappings, questionMap]);

  const selectedFailureMode = failureModes.find((fm) => fm._id === selectedId);

  const handleUnassign = async (questionId: Id<"questions">) => {
    if (!selectedId) return;
    await unassignQuestion({ failureModeId: selectedId, questionId });
  };

  return (
    <div className="flex-1 overflow-hidden flex">
      <FailureModeListPane
        failureModes={failureModes}
        mappingCounts={mappingCounts}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {selectedFailureMode ? (
        <FailureModeDetail
          failureMode={selectedFailureMode}
          mappedQuestions={mappedQuestions}
          experimentId={experimentId as string}
          onUnassign={handleUnassign}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
          Select a failure mode to view details.
        </div>
      )}

      <UnmappedPane
        unmappedQuestions={unmappedQuestions}
        failureModes={failureModes}
        experimentId={experimentId}
      />
    </div>
  );
}
