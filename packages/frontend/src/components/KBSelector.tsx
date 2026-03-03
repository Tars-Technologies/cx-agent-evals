"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { FileUploader } from "./FileUploader";

interface KBSelectorProps {
  selectedKbId: Id<"knowledgeBases"> | null;
  onSelect: (kbId: Id<"knowledgeBases">) => void;
}

export function KBSelector({ selectedKbId, onSelect }: KBSelectorProps) {
  const kbs = useQuery(api.knowledgeBases.list);
  const documents = useQuery(
    api.documents.listByKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const createKb = useMutation(api.knowledgeBases.create);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createKb({ name: newName.trim() });
      onSelect(id);
      setNewName("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs text-text-muted uppercase tracking-wide">
          Knowledge Base
        </label>

        {kbs === undefined ? (
          <div className="flex items-center gap-2 text-text-dim text-sm">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-2">
            <select
              value={selectedKbId ?? ""}
              onChange={(e) => {
                if (e.target.value) {
                  onSelect(e.target.value as Id<"knowledgeBases">);
                }
              }}
              className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
            >
              <option value="">Select a knowledge base...</option>
              {kbs.map((kb) => (
                <option key={kb._id} value={kb._id}>
                  {kb.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => setShowCreate(!showCreate)}
              className="text-xs text-text-dim hover:text-accent transition-colors"
            >
              + Create new
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="border border-border rounded bg-bg-elevated p-3 space-y-2 animate-fade-in">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Knowledge base name..."
            className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent outline-none"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="px-3 py-1 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1 text-xs text-text-dim hover:text-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedKbId && (
        <div className="space-y-3">
          <FileUploader kbId={selectedKbId} />

          {documents === undefined ? (
            <div className="flex items-center gap-2 text-text-dim text-xs">
              <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              Loading documents...
            </div>
          ) : documents.length > 0 ? (
            <div className="border border-border rounded bg-bg-elevated">
              <div className="px-3 py-1.5 border-b border-border text-xs text-text-dim uppercase tracking-wide">
                Documents ({documents.length})
              </div>
              <div className="max-h-48 overflow-y-auto">
                {documents.map((doc) => (
                  <div
                    key={doc._id}
                    className="px-3 py-1.5 text-xs text-text border-b border-border/50 last:border-0 flex justify-between"
                  >
                    <span className="truncate">{doc.title}</span>
                    <span className="text-text-dim flex-shrink-0 ml-2">
                      {(doc.contentLength / 1024).toFixed(1)}k
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-dim">
              No documents yet. Upload .md files above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
