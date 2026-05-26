"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { Spinner } from "@/components/shell/Spinner";

// ── Types ─────────────────────────────────────────────────────────────────────

type FailureMode = {
  _id: Id<"failureModes">;
  agentId: Id<"agents">;
  name: string;
  description: string;
  order: number;
};

type SimRun = {
  _id: Id<"conversationSimRuns">;
  conversationId?: Id<"conversations">;
  scenarioTopic: string;
};

type Membership = {
  _id: Id<"failureModeMemberships">;
  failureModeId: Id<"failureModes">;
  source:
    | { kind: "conversation"; conversationId: Id<"conversations"> }
    | { kind: "transcript"; transcriptId: Id<"livechatConversations"> };
};

// ── Small reusable UI atoms ───────────────────────────────────────────────────

function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[480px] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-border">
      <h3 className="text-sm font-medium text-text">{title}</h3>
      <button
        onClick={onClose}
        className="text-text-dim hover:text-text transition-colors cursor-pointer text-lg leading-none"
        aria-label="Close"
      >
        &times;
      </button>
    </div>
  );
}

// ── Create failure mode modal ─────────────────────────────────────────────────

function CreateFailureModeModal({
  agentId,
  onClose,
}: {
  agentId: Id<"agents">;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const create = useMutation(api.failureModes.crud.create);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await create({ agentId, name: name.trim(), description: description.trim() });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="New failure mode" onClose={onClose} />
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="text-xs text-text-dim block mb-1">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hallucinated policy details"
            className="w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 placeholder:text-text-dim focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>
        <div>
          <label className="text-xs text-text-dim block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe when this failure mode occurs…"
            className="w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 placeholder:text-text-dim focus:outline-none focus:border-accent/50 transition-colors resize-none"
          />
        </div>
        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="w-full py-2 text-sm rounded-lg font-medium bg-accent text-bg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors cursor-pointer"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </form>
    </Modal>
  );
}

// ── Spawn judge modal ─────────────────────────────────────────────────────────

function SpawnJudgeModal({
  failureMode,
  agentId,
  onClose,
}: {
  failureMode: FailureMode;
  agentId: Id<"agents">;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(failureMode.name);
  const [rubric, setRubric] = useState(failureMode.description);
  const [busy, setBusy] = useState(false);
  const spawnJudge = useMutation(api.evaluator.spawnJudge.fromFailureMode);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const evalId = await spawnJudge({
        failureModeId: failureMode._id,
        nameOverride: name.trim() || undefined,
        rubricOverride: rubric.trim() || undefined,
      });
      onClose();
      router.push(`/agents/${agentId}/evaluate/evaluators/${evalId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Create judge from failure mode" onClose={onClose} />
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <p className="text-xs text-text-dim">
          Creates an LLM judge evaluator pre-seeded with FAIL labels from this
          failure mode&apos;s members.
        </p>
        <div>
          <label className="text-xs text-text-dim block mb-1">Evaluator name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>
        <div>
          <label className="text-xs text-text-dim block mb-1">Rubric override</label>
          <textarea
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
            rows={4}
            placeholder="Leave blank to use default rubric derived from description"
            className="w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 placeholder:text-text-dim focus:outline-none focus:border-accent/50 transition-colors resize-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 text-sm rounded-lg font-medium bg-accent text-bg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors cursor-pointer"
        >
          {busy ? "Creating…" : "Create evaluator"}
        </button>
      </form>
    </Modal>
  );
}

// ── Member panel for a single failure mode ────────────────────────────────────

function MembersPanel({
  failureMode,
  runs,
}: {
  failureMode: FailureMode;
  runs: SimRun[];
}) {
  const memberships = useQuery(api.failureModes.memberships.byFailureMode, {
    failureModeId: failureMode._id,
  }) as Membership[] | undefined;

  const addMembership = useMutation(api.failureModes.memberships.add);
  const removeMembership = useMutation(api.failureModes.memberships.remove);

  const annotatableRuns = runs.filter((r) => r.conversationId != null);

  if (memberships === undefined) {
    return (
      <div className="mt-2 p-3 bg-bg-surface rounded border border-border flex items-center justify-center h-16">
        <Spinner label="Loading members…" />
      </div>
    );
  }

  // Build a Set of conversationIds that are currently members
  const memberConvIds = new Set(
    memberships
      .filter((m) => m.source.kind === "conversation")
      .map((m) => (m.source as { kind: "conversation"; conversationId: string }).conversationId),
  );

  async function toggle(convId: Id<"conversations">, isMember: boolean) {
    const source = { kind: "conversation" as const, conversationId: convId };
    if (isMember) {
      await removeMembership({ failureModeId: failureMode._id, source });
    } else {
      await addMembership({ failureModeId: failureMode._id, source });
    }
  }

  if (annotatableRuns.length === 0) {
    return (
      <div className="mt-2 p-3 bg-bg-surface rounded border border-border text-xs text-text-dim">
        No conversations in this run yet.
      </div>
    );
  }

  return (
    <div className="mt-2 bg-bg-surface rounded border border-border divide-y divide-border/50">
      {annotatableRuns.map((run) => {
        const convId = run.conversationId!;
        const isMember = memberConvIds.has(convId);
        const label = run.scenarioTopic
          ? run.scenarioTopic.length > 48
            ? run.scenarioTopic.slice(0, 48) + "…"
            : run.scenarioTopic
          : `conv-${convId.slice(-6)}`;

        return (
          <label
            key={convId}
            className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-bg-hover transition-colors"
          >
            <input
              type="checkbox"
              checked={isMember}
              onChange={() => toggle(convId, isMember)}
              className="accent-accent flex-shrink-0"
            />
            <span className="text-xs text-text truncate flex-1">{label}</span>
            <span className="text-[10px] font-mono text-text-dim flex-shrink-0">
              {convId.slice(-6)}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ── Single failure mode card ──────────────────────────────────────────────────

function FailureModeCard({
  fm,
  agentId,
  runs,
}: {
  fm: FailureMode;
  agentId: Id<"agents">;
  runs: SimRun[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const memberships = useQuery(api.failureModes.memberships.byFailureMode, {
    failureModeId: fm._id,
  }) as Membership[] | undefined;

  const removeFm = useMutation(api.failureModes.crud.remove);

  const memberCount = memberships?.length ?? 0;

  async function handleDelete() {
    setDeleting(true);
    try {
      await removeFm({ id: fm._id });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <div className="bg-bg-elevated border border-border rounded-lg overflow-hidden">
        {/* Card header */}
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text">{fm.name}</div>
            {fm.description && (
              <div className="text-xs text-text-dim mt-0.5 line-clamp-2">
                {fm.description}
              </div>
            )}
            <div className="text-[10px] text-text-dim mt-1">
              {memberCount} conversation{memberCount !== 1 ? "s" : ""} mapped
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs px-2 py-1 rounded border border-border text-text-dim hover:text-text hover:border-accent/40 transition-colors cursor-pointer"
            >
              {expanded ? "Hide members" : "Manage members"}
            </button>
            <button
              onClick={() => setShowSpawnModal(true)}
              className="text-xs px-2 py-1 rounded border border-border text-accent hover:border-accent/60 hover:bg-accent/5 transition-colors cursor-pointer"
            >
              Spawn judge
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {deleting ? "…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs px-2 py-1 rounded border border-border text-text-dim hover:text-text transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs px-2 py-1 rounded border border-border text-text-dim hover:text-red-400 hover:border-red-400/30 transition-colors cursor-pointer"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Expanded members panel */}
        {expanded && (
          <div className="px-4 pb-3">
            <MembersPanel failureMode={fm} runs={runs} />
          </div>
        )}
      </div>

      {showSpawnModal && (
        <SpawnJudgeModal
          failureMode={fm}
          agentId={agentId}
          onClose={() => setShowSpawnModal(false)}
        />
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AxialCodingPage() {
  const params = useParams<{ id: string; runId: string }>();
  const agentId = params.id as Id<"agents">;
  const simId = params.runId as Id<"conversationSimulations">;

  const [showCreateModal, setShowCreateModal] = useState(false);

  const failureModes = useQuery(api.failureModes.crud.byAgent, { agentId }) as
    | FailureMode[]
    | undefined;

  const runs = useQuery(api.conversationSim.runs.bySimulation, {
    simulationId: simId,
  }) as SimRun[] | undefined;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (failureModes === undefined || runs === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-base font-semibold text-text">Axial coding</h1>
            <p className="text-xs text-text-dim mt-0.5">
              Map conversations from this run to failure modes, then spawn
              judges to auto-evaluate.
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-xs px-3 py-1.5 rounded border border-border text-accent hover:border-accent/60 hover:bg-accent/5 transition-colors cursor-pointer"
          >
            + New failure mode
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-4">
          {failureModes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-text-dim text-sm mb-1">
                No failure modes yet.
              </div>
              <div className="text-text-dim text-xs">
                Create one to start mapping conversations.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {failureModes.map((fm) => (
                <FailureModeCard
                  key={fm._id}
                  fm={fm}
                  agentId={agentId}
                  runs={runs}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateFailureModeModal
          agentId={agentId}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </>
  );
}
