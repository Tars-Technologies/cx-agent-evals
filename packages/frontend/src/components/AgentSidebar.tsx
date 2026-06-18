"use client"

import type { Id } from "@convex/_generated/dataModel"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "@/lib/convex"

interface AgentSidebarProps {
  selectedAgentId: Id<"agents"> | null
  onSelectAgent: (id: Id<"agents"> | null) => void
}

export default function AgentSidebar({
  selectedAgentId,
  onSelectAgent
}: AgentSidebarProps) {
  const agents = useQuery(api.crud.agents.byOrg) ?? []
  const createAgent = useMutation(api.crud.agents.create)
  const removeAgent = useMutation(api.crud.agents.remove)
  const [deleteTarget, setDeleteTarget] = useState<Id<"agents"> | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState("")

  const handleCreate = async () => {
    const id = await createAgent({
      name: "New Agent",
      identity: {
        agentName: "New Agent",
        companyName: "",
        roleDescription: "You are a helpful customer support agent."
      },
      guardrails: {},
      responseStyle: {
        formality: "professional",
        length: "concise"
      },
      model: "claude-sonnet-4-6",
      enableReflection: false,
      retrieverIds: []
    })
    onSelectAgent(id)
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleteConfirm !== "delete") return
    if (selectedAgentId === deleteTarget) onSelectAgent(null)
    await removeAgent({ id: deleteTarget })
    setDeleteTarget(null)
    setDeleteConfirm("")
  }

  // Agents come from backend in ascending order (oldest first, new at bottom)
  const sortedAgents = agents

  return (
    <div className="w-[220px] bg-bg-elevated border-r border-border flex flex-col flex-shrink-0 min-h-0">
      {/* Sticky header */}
      <div className="p-3 border-b border-border flex justify-between items-center flex-shrink-0">
        <span className="text-text-muted text-xs uppercase tracking-wider">
          Agents
        </span>
        <button
          onClick={handleCreate}
          className="bg-accent text-bg text-xs px-2 py-0.5 rounded font-medium hover:bg-accent/90 transition-colors"
        >
          + New
        </button>
      </div>

      {/* Scrollable agent list */}
      <div className="flex-1 overflow-y-auto p-2">
        {sortedAgents.length === 0 && (
          <p className="text-text-dim text-xs p-2">
            No agents yet. Create one to get started.
          </p>
        )}
        {sortedAgents.map((agent) => (
          <div
            key={agent._id}
            className={`group relative rounded-md mb-1 transition-colors ${
              selectedAgentId === agent._id
                ? "bg-bg-surface border-l-[3px] border-l-accent"
                : "border-l-[3px] border-l-transparent hover:bg-bg-surface/50"
            }`}
          >
            <button
              onClick={() => onSelectAgent(agent._id)}
              className="w-full text-left p-2.5"
            >
              <div
                className={`text-[11px] font-medium ${selectedAgentId === agent._id ? "text-text" : "text-text-muted"}`}
              >
                {agent.name}
              </div>
              <div className="text-text-dim text-[9px] mt-0.5">
                {agent.model.replace("claude-", "").replace(/-\d+$/, "")}
              </div>
              <div className="flex gap-1 mt-1 flex-wrap">
                <span className="text-[8px] px-1.5 py-px rounded bg-bg-elevated text-text-muted">
                  {agent.retrieverIds.length} retriever
                  {agent.retrieverIds.length !== 1 ? "s" : ""}
                </span>
                <span
                  className={`text-[8px] px-1.5 py-px rounded-full ${
                    agent.status === "ready"
                      ? "bg-accent/10 text-accent"
                      : agent.status === "error"
                        ? "bg-red-500/10 text-red-400"
                        : "bg-yellow-500/10 text-yellow-400"
                  }`}
                >
                  {agent.status}
                </span>
              </div>
            </button>
            {/* Delete button — visible on hover */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setDeleteTarget(agent._id)
                setDeleteConfirm("")
              }}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 transition-all p-1"
              title="Delete agent"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-bg-elevated border border-border rounded-lg p-5 max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-text text-sm font-semibold mb-2">
              Delete Agent
            </h3>
            <p className="text-text-muted text-xs mb-3">
              This will permanently delete this agent and cannot be undone. Type{" "}
              <strong className="text-text">delete</strong> to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder='Type "delete" to confirm'
              className="w-full bg-bg-surface border border-border rounded-md px-3 py-2 text-xs text-text focus:border-red-500/50 focus:outline-none mb-3"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirm !== "delete"}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                  deleteConfirm === "delete"
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-border text-text-dim cursor-not-allowed"
                }`}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
