"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { CreateEvaluatorModal } from "@/components/evaluators/CreateEvaluatorModal";

type Evaluator = NonNullable<
  ReturnType<typeof useQuery<typeof api.evaluator.crud.byAgent>>
>[number];

type EvaluatorStatus = Evaluator["status"];

const STATUS_BADGE: Record<EvaluatorStatus, string> = {
  draft: "bg-yellow-500/15 text-yellow-400",
  calibrating: "bg-accent/15 text-accent",
  validated: "bg-accent/15 text-accent",
  ready: "bg-green-500/15 text-green-400",
};

const TYPE_BADGE: Record<"code" | "llm_judge", string> = {
  code: "bg-blue-500/15 text-blue-400",
  llm_judge: "bg-purple-500/15 text-purple-400",
};

function provenanceLabel(source: Evaluator["source"]): string {
  if (source.kind === "manual") return "Manual";
  if (source.kind === "template") return "From template";
  if (source.kind === "error_analysis") return "From failure mode";
  return "Unknown";
}

function LabelCounts({ evaluatorId }: { evaluatorId: Id<"evaluators"> }) {
  const counts = useQuery(api.evaluator.labels.counts, { evaluatorId });
  if (counts === undefined) {
    return <span className="text-[10px] text-text-dim animate-pulse">···</span>;
  }
  return (
    <span className="text-[10px] text-text-dim">
      {counts.total} labels · {counts.pass}P / {counts.fail}F
    </span>
  );
}

function EvaluatorRow({
  evaluator,
  agentId,
}: {
  evaluator: Evaluator;
  agentId: Id<"agents">;
}) {
  const router = useRouter();
  const statusCls = STATUS_BADGE[evaluator.status] ?? "bg-border text-text-dim";
  const typeCls = TYPE_BADGE[evaluator.type] ?? "bg-border text-text-dim";

  return (
    <button
      className="w-full text-left px-4 py-3 border border-border rounded-lg bg-bg-elevated hover:bg-bg-surface transition-colors flex items-center gap-4"
      onClick={() =>
        router.push(`/agents/${agentId}/evaluate/evaluators/${evaluator._id}`)
      }
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text font-medium truncate">{evaluator.name}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${typeCls}`}
          >
            {evaluator.type === "llm_judge" ? "llm judge" : evaluator.type}
          </span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${statusCls}`}
          >
            {evaluator.status}
          </span>
          <span className="text-[10px] text-text-dim">
            {provenanceLabel(evaluator.source)}
          </span>
        </div>
      </div>
      <div className="shrink-0">
        <LabelCounts evaluatorId={evaluator._id} />
      </div>
      <span className="text-text-dim text-xs shrink-0">›</span>
    </button>
  );
}

export default function AgentEvaluatorsPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id as Id<"agents">;

  const evaluators = useQuery(api.evaluator.crud.byAgent, { agentId });
  const removeEvaluator = useMutation(api.evaluator.crud.remove);

  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  function handleCreated(newId: Id<"evaluators">) {
    setShowModal(false);
    router.push(`/agents/${agentId}/evaluate/evaluators/${newId}`);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-sm font-medium text-text">Evaluators</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          <span>+</span> New evaluator
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {evaluators === undefined ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : evaluators.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
            <p className="text-sm text-text-dim">No evaluators yet.</p>
            <p className="text-xs text-text-muted mt-1">
              Click &apos;+ New evaluator&apos; to create one.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {evaluators.map((ev) => (
              <EvaluatorRow key={ev._id} evaluator={ev} agentId={agentId} />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <CreateEvaluatorModal
          agentId={agentId}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
