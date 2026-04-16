"use client";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import AgentConfigPanel from "@/components/AgentConfigPanel";
import AgentPlayground from "@/components/AgentPlayground";
import { ExperimentModeLayout } from "@/components/agent-experiments/ExperimentModeLayout";

// ---------------------------------------------------------------------------
// URL param helpers
// ---------------------------------------------------------------------------

function useUrlState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const mode = (searchParams.get("mode") as "create" | "experiment") ?? "create";
  const agentId = searchParams.get("agent") as Id<"agents"> | null;
  const experimentId = searchParams.get("experiment") as Id<"experiments"> | null;

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const setMode = useCallback(
    (m: "create" | "experiment") => setParams({ mode: m }),
    [setParams],
  );
  const setAgentId = useCallback(
    (id: Id<"agents"> | null) => setParams({ agent: id }),
    [setParams],
  );
  const setExperimentId = useCallback(
    (id: Id<"experiments"> | null) => setParams({ experiment: id }),
    [setParams],
  );

  return { mode, agentId, experimentId, setMode, setAgentId, setExperimentId, setParams };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-bg" />}>
      <AgentsPageContent />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------

function AgentsPageContent() {
  const { mode, agentId, experimentId, setMode, setAgentId, setExperimentId, setParams } =
    useUrlState();

  // --- Agent data ---
  const agents = useQuery(api.crud.agents.byOrg) ?? [];
  const createAgent = useMutation(api.crud.agents.create);

  // --- New agent handler ---
  const handleNewAgent = useCallback(async () => {
    const id = await createAgent({
      name: "New Agent",
      identity: {
        agentName: "New Agent",
        companyName: "",
        roleDescription: "You are a helpful customer support agent.",
      },
      guardrails: {},
      responseStyle: { formality: "professional", length: "concise" },
      model: "claude-sonnet-4-20250514",
      enableReflection: false,
      retrieverIds: [],
    });
    setAgentId(id);
  }, [createAgent, setAgentId]);

  // --- Experiment modal ---
  const [showExperimentModal, setShowExperimentModal] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <Header mode="agents" />

      {/* ── Top bar — mode toggle, agent dropdown, primary button ── */}
      <div className="flex items-center gap-3 border-b border-border bg-bg-elevated px-6 py-2.5">
        {/* Mode toggle */}
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setMode("create")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "create"
                ? "bg-accent/10 text-accent"
                : "text-text-dim hover:text-text"
            }`}
          >
            Create
          </button>
          <button
            onClick={() => setMode("experiment")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "experiment"
                ? "bg-accent/10 text-accent"
                : "text-text-dim hover:text-text"
            }`}
          >
            Experiment
          </button>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Agent dropdown — always visible */}
        <select
          value={agentId ?? ""}
          onChange={(e) =>
            setAgentId(e.target.value ? (e.target.value as Id<"agents">) : null)
          }
          className="w-56 bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none truncate"
        >
          <option value="">Select agent...</option>
          {agents.map((a) => (
            <option key={a._id} value={a._id}>
              {a.name} ({a.status})
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Primary button — context-dependent */}
        {mode === "create" ? (
          <button
            onClick={handleNewAgent}
            className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-bg-elevated hover:bg-accent/90 transition-colors cursor-pointer"
          >
            + New Agent
          </button>
        ) : (
          <button
            onClick={() => setShowExperimentModal(true)}
            className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-bg-elevated hover:bg-accent/90 transition-colors cursor-pointer"
          >
            + New Experiment
          </button>
        )}
      </div>

      {/* ── Main content ── */}
      {mode === "create" ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {agentId ? (
            <div className="flex-1 grid grid-cols-[380px_1fr] min-h-0 min-w-0">
              <div className="border-r border-border flex flex-col min-h-0">
                <AgentConfigPanel agentId={agentId} />
              </div>
              <AgentPlayground agentId={agentId} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4">
                <p className="text-text-muted text-sm">
                  Select an agent to configure, or create a new one.
                </p>
                <button
                  onClick={handleNewAgent}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent/90 text-bg-elevated transition-colors cursor-pointer"
                >
                  Create New Agent
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <ExperimentModeLayout
          selectedRunId={experimentId}
          onSelectRun={(id) => setExperimentId(id)}
          showCreateModal={showExperimentModal}
          onCloseCreateModal={() => setShowExperimentModal(false)}
          onCreated={(id) => {
            setExperimentId(id);
            setShowExperimentModal(false);
          }}
        />
      )}
    </div>
  );
}
