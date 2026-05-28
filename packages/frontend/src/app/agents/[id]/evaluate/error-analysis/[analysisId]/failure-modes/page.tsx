"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, usePathname } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { FailureModeCard } from "@/components/errorAnalysis/FailureModeCard";
import { ImportMoreModal } from "@/components/errorAnalysis/ImportMoreModal";

const ORIGIN_LABEL: Record<string, string> = {
  simulation: "SIMULATION",
  upload: "UPLOAD",
  playground: "PLAYGROUND",
  custom: "CUSTOM",
};

function ErrorAnalysisHeader({
  agentId,
  analysisId,
  onImport,
}: {
  agentId: Id<"agents">;
  analysisId: Id<"errorAnalyses">;
  onImport(): void;
}) {
  const pathname = usePathname() ?? "";
  const analysis = useQuery(api.errorAnalysis.orchestration.get, { id: analysisId });
  const annotateHref = `/agents/${agentId}/evaluate/error-analysis/${analysisId}/annotate`;
  const failureModesHref = `/agents/${agentId}/evaluate/error-analysis/${analysisId}/failure-modes`;
  const tabs = [
    { label: "Annotate", href: annotateHref },
    { label: "Failure modes", href: failureModesHref },
  ];

  return (
    <div className="border-b border-border bg-bg-elevated/40 shrink-0">
      <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="text-sm font-medium text-text">
          {analysis?.name ?? "…"}
        </div>
        {analysis && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-bg-surface text-text-dim">
            {ORIGIN_LABEL[analysis.origin.kind] ?? analysis.origin.kind}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onImport}
            className="px-2.5 py-1 text-[11px] text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
          >
            Import more
          </button>
        </div>
      </div>
      <div className="px-4 flex gap-1">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-3 py-1.5 text-xs border-b-2 transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-text-dim hover:text-text"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function NewFailureModeModal({
  agentId,
  errorAnalysisId,
  open,
  onClose,
}: {
  agentId: Id<"agents">;
  errorAnalysisId: Id<"errorAnalyses">;
  open: boolean;
  onClose(): void;
}) {
  const create = useMutation(api.failureModes.crud.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await create({
        agentId,
        errorAnalysisId,
        name: name.trim(),
        description: description.trim(),
      });
      setName("");
      setDescription("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-text">New failure mode</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            placeholder="e.g. Hallucinated policy"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none resize-none"
            placeholder="Describe the failure pattern…"
          />
        </div>
        {error && (
          <div className="text-xs text-red-400 border border-red-900/50 bg-red-950/30 rounded px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-dim hover:text-text border border-border rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
            className="px-4 py-2 text-sm bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FailureModesPage() {
  const { id, analysisId } = useParams<{ id: string; analysisId: string }>();
  const agentId = id as Id<"agents">;
  const errorAnalysisId = analysisId as Id<"errorAnalyses">;
  const router = useRouter();

  const analysis = useQuery(api.errorAnalysis.orchestration.get, {
    id: errorAnalysisId,
  });
  const modes = useQuery(api.failureModes.crud.byAnalysisWithCounts, {
    errorAnalysisId,
  });
  const spawnJudge = useMutation(api.evaluator.spawnJudge.fromFailureMode);

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const list = modes ?? [];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ErrorAnalysisHeader
        agentId={agentId}
        analysisId={errorAnalysisId}
        onImport={() => setImportOpen(true)}
      />

      <div className="px-4 py-3 flex items-center justify-between border-b border-border shrink-0">
        <div className="text-xs text-text-dim">
          {modes !== undefined &&
            `${list.length} failure mode${list.length === 1 ? "" : "s"}`}
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          + New failure mode
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {modes === undefined ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 rounded bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
            <p className="text-sm text-text-dim">No failure modes yet.</p>
            <p className="text-xs text-text-muted mt-1">
              Click &lsquo;+ New failure mode&rsquo; to add one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((m) => (
              <FailureModeCard
                key={m._id}
                failureMode={m}
                memberCount={m.memberCount}
                judgeCount={m.judgeCount}
                onSpawnJudge={async () => {
                  const evalId = await spawnJudge({ failureModeId: m._id });
                  router.push(
                    `/agents/${agentId}/evaluate/evaluators/${evalId}`,
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>

      <NewFailureModeModal
        agentId={agentId}
        errorAnalysisId={errorAnalysisId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <ImportMoreModal
        errorAnalysisId={errorAnalysisId}
        origin={analysis?.origin ?? { kind: "custom" }}
        agentId={agentId}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => setImportOpen(false)}
      />
    </div>
  );
}
