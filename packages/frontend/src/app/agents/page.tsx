"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { EntityListLayout } from "@/components/shell/EntityListLayout";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colorClass =
    status === "ready"
      ? "text-accent"
      : status === "error"
        ? "text-red-400"
        : "text-yellow-400";
  return (
    <span className={`text-xs font-medium capitalize ${colorClass}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create-agent modal (inline)
// ---------------------------------------------------------------------------

interface CreateAgentModalProps {
  onClose: () => void;
  onCreated: (id: Id<"agents">) => void;
}

function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const createAgent = useMutation(api.crud.agents.create);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const id = await createAgent({
        name: trimmed,
        identity: {
          agentName: trimmed,
          companyName: "",
          roleDescription: "You are a helpful customer support agent.",
        },
        guardrails: {},
        responseStyle: { formality: "professional", length: "concise" },
        model: "claude-sonnet-4-6",
        enableReflection: false,
        retrieverIds: [],
      });
      onCreated(id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border rounded-lg p-6 w-full max-w-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-text mb-4">
          Create New Agent
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="agent-name"
              className="block text-xs text-text-muted mb-1"
            >
              Agent name
            </label>
            <input
              id="agent-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Support Bot"
              autoFocus
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="px-4 py-1.5 text-xs font-semibold bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const router = useRouter();
  const agents = useQuery(api.crud.agents.byOrg, {});
  const [showModal, setShowModal] = useState(false);

  function handleCreated(id: Id<"agents">) {
    setShowModal(false);
    router.push(`/agents/${id}/configure`);
  }

  const headerActions = (
    <button
      onClick={() => setShowModal(true)}
      className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-bg-elevated hover:bg-accent/90 transition-colors cursor-pointer"
    >
      + New agent
    </button>
  );

  return (
    <EntityListLayout title="Agents" actions={headerActions}>
      {/* Loading state */}
      {agents === undefined && (
        <div className="flex items-center justify-center py-20 text-text-muted text-sm">
          Loading agents…
        </div>
      )}

      {/* Empty state */}
      {agents !== undefined && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-text-muted text-sm">No agents yet.</p>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent/90 text-bg-elevated transition-colors cursor-pointer"
          >
            Create your first agent
          </button>
        </div>
      )}

      {/* Agent grid */}
      {agents !== undefined && agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent._id}
              onClick={() => router.push(`/agents/${agent._id}/configure`)}
              className="bg-bg-elevated border border-border hover:border-accent rounded-lg p-4 cursor-pointer transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-sm font-medium text-text truncate">
                  {agent.name}
                </span>
                <StatusBadge status={agent.status} />
              </div>
              <p className="text-xs text-text-muted">
                {new Date(agent.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <CreateAgentModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </EntityListLayout>
  );
}
