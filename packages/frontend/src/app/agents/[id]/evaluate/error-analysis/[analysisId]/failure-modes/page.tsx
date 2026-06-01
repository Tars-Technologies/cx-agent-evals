"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useParams,
  useRouter,
  usePathname,
  useSearchParams,
} from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import {
  FailureModeDetail,
  type FailureModeWithCounts,
  type AnalysisMember,
} from "@/components/errorAnalysis/FailureModeDetail";
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
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const analysis = useQuery(api.errorAnalysis.orchestration.get, {
    id: errorAnalysisId,
  });
  const modes = useQuery(api.failureModes.crud.byAnalysisWithCounts, {
    errorAnalysisId,
  });
  const members = useQuery(api.errorAnalysis.orchestration.membersByAnalysis, {
    errorAnalysisId,
  });
  const spawnJudge = useMutation(api.evaluator.spawnJudge.fromFailureMode);
  const recluster = useAction(api.errorAnalysis.clustering.recluster);

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [clustering, setClustering] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);

  const list = modes ?? [];

  // Selected failure mode (URL-persisted via ?fm=, auto-select first).
  const fmParam = searchParams.get("fm");
  const selected =
    list.find((m) => m._id === fmParam) ?? (list.length > 0 ? list[0] : null);
  const selectedId = selected?._id ?? null;

  const memberships = useQuery(
    api.failureModes.memberships.byFailureMode,
    selectedId ? { failureModeId: selectedId } : "skip",
  );

  function selectMode(modeId: Id<"failureModes">) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("fm", modeId);
    router.replace(`${pathname}?${sp.toString()}`);
  }

  async function handleSpawnJudge(failureModeId: Id<"failureModes">) {
    const evalId = await spawnJudge({ failureModeId });
    router.push(`/agents/${agentId}/evaluate/evaluators/${evalId}`);
  }

  // Clustering only uses failing annotations, so gate generation on having at
  // least one. membersByAnalysis already carries each member's annotationRating.
  const failingCount = (members ?? []).filter(
    (m) => m.annotationRating === "fail" || m.annotationRating === "bad",
  ).length;
  const canGenerate = failingCount > 0;
  const hasModes = list.length > 0;

  async function handleGenerate() {
    if (clustering || !canGenerate) return;
    // Regenerating replaces existing modes (destructive) — confirm only then.
    if (hasModes) {
      const ok = window.confirm(
        "This will replace all existing failure modes for this analysis with a new LLM-generated set. Manual failure modes will also be deleted. Continue?",
      );
      if (!ok) return;
    }
    setClustering(true);
    setClusterError(null);
    try {
      await recluster({ errorAnalysisId });
    } catch (e) {
      setClusterError(e instanceof Error ? e.message : "Failed to generate");
    } finally {
      setClustering(false);
    }
  }

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
        <div className="flex items-center gap-2">
          {clusterError && (
            <span className="text-[11px] text-red-400">{clusterError}</span>
          )}
          <button
            onClick={() => setCreateOpen(true)}
            className="px-2.5 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text hover:border-border-bright transition-colors"
            title="Add a failure mode manually"
          >
            + New
          </button>
          <button
            onClick={handleGenerate}
            disabled={clustering || !canGenerate}
            className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={
              canGenerate
                ? hasModes
                  ? "Replace all failure modes with a new LLM-generated set"
                  : "Cluster failing annotations into failure modes"
                : "Annotate at least one conversation as Fail first."
            }
          >
            {clustering
              ? "Generating…"
              : hasModes
                ? "⟲ Regenerate"
                : "✨ Generate failure modes"}
          </button>
        </div>
      </div>

      {modes === undefined ? (
        <div className="flex-1 px-4 py-3">
          <div className="h-32 rounded bg-bg-elevated border border-border animate-pulse" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[200px] text-center gap-3 px-4">
          <div>
            <p className="text-sm text-text-dim">No failure modes yet.</p>
            <p className="text-xs text-text-muted mt-1">
              Cluster your failing annotations into failure-mode buckets.
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={clustering || !canGenerate}
            className="px-4 py-2 text-sm bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {clustering ? "Generating…" : "✨ Generate failure modes"}
          </button>
          {!canGenerate && (
            <p className="text-xs text-text-muted">
              Annotate at least one conversation as{" "}
              <span className="text-red-400">Fail</span>, then generate.
            </p>
          )}
          {clusterError && (
            <p className="text-xs text-red-400">{clusterError}</p>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left: failure mode list */}
          <div className="w-1/4 min-w-[220px] border-r border-border overflow-y-auto">
            <ul className="divide-y divide-border">
              {list.map((m) => {
                const active = m._id === selectedId;
                return (
                  <li key={m._id}>
                    <button
                      onClick={() => selectMode(m._id)}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        active
                          ? "bg-accent/10 text-accent"
                          : "text-text hover:bg-bg-elevated"
                      }`}
                    >
                      <div className="text-xs font-medium truncate">
                        {m.name}
                      </div>
                      <div className="text-[10px] text-text-dim mt-0.5">
                        {m.memberCount} conv{m.memberCount === 1 ? "" : "s"}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Right: selected failure mode detail */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {selected ? (
              <FailureModeDetail
                mode={selected as FailureModeWithCounts}
                members={(members ?? []) as AnalysisMember[]}
                memberships={memberships}
                onSpawnJudge={() => handleSpawnJudge(selected._id)}
                onDeleted={() => {
                  const sp = new URLSearchParams(searchParams.toString());
                  sp.delete("fm");
                  router.replace(`${pathname}?${sp.toString()}`);
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-text-dim">
                Select a failure mode.
              </div>
            )}
          </div>
        </div>
      )}

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
