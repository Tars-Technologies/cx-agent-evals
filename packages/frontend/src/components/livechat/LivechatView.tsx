"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TabBar } from "./TabBar";
import { StatsTab } from "./StatsTab";
import { TranscriptsTab } from "./TranscriptsTab";
import { MicrotopicsTab } from "./MicrotopicsTab";
import type { LivechatTab, UploadEntry, LoadedData } from "./types";

function DeleteConfirmModal({
  filename,
  onConfirm,
  onCancel,
}: {
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-elevated border border-border rounded-lg p-5 w-[400px] shadow-xl">
        <h3 className="text-sm font-semibold text-text mb-2">
          Delete upload?
        </h3>
        <p className="text-xs text-text-muted mb-1">
          This will permanently delete the uploaded CSV and all processed output
          files for:
        </p>
        <p className="text-xs text-accent mb-3 truncate">{filename}</p>
        <p className="text-xs text-text-dim mb-2">
          Type <span className="text-red-400 font-semibold">delete</span> to
          confirm.
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="delete"
          className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none mb-3"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmText !== "delete"}
            className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function LivechatView() {
  const [activeTab, setActiveTab] = useState<LivechatTab>("stats");
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [loadedData, setLoadedData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UploadEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastLoadedId = useRef<string | null>(null);
  const lastManifestJson = useRef<string>("");

  // Poll manifest for upload status
  const refreshManifest = useCallback(async () => {
    try {
      const res = await fetch("/api/livechat/manifest");
      if (res.ok) {
        const text = await res.text();
        if (text !== lastManifestJson.current) {
          lastManifestJson.current = text;
          setUploads(JSON.parse(text));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshManifest();
    const hasPending = uploads.some(
      (u) => u.status !== "ready" && u.status !== "error"
    );
    if (hasPending || uploads.length === 0) {
      const interval = setInterval(refreshManifest, 3000);
      return () => clearInterval(interval);
    }
  }, [refreshManifest, uploads]);

  // Load data when selecting an upload
  useEffect(() => {
    if (!selectedUploadId) {
      setLoadedData(null);
      lastLoadedId.current = null;
      return;
    }
    if (lastLoadedId.current === selectedUploadId && loadedData) {
      return;
    }
    const upload = uploads.find((u) => u.id === selectedUploadId);
    if (!upload || upload.status !== "ready") {
      setLoadedData(null);
      lastLoadedId.current = null;
      return;
    }

    lastLoadedId.current = selectedUploadId;
    setLoading(true);
    Promise.all([
      fetch(`/api/livechat/data/${selectedUploadId}?type=basicStats`).then(
        (r) => r.json()
      ),
      fetch(
        `/api/livechat/data/${selectedUploadId}?type=rawTranscripts`
      ).then((r) => r.json()),
      fetch(`/api/livechat/data/${selectedUploadId}?type=microtopics`).then(
        (r) => r.json()
      ),
    ])
      .then(([basicStats, rawTranscripts, microtopics]) => {
        setLoadedData({ basicStats, rawTranscripts, microtopics });
      })
      .catch(() => {
        setLoadedData(null);
        lastLoadedId.current = null;
      })
      .finally(() => setLoading(false));
  }, [selectedUploadId, uploads, loadedData]);

  async function handleUpload(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      await fetch("/api/livechat/upload", { method: "POST", body: formData });
      lastManifestJson.current = "";
      await refreshManifest();
    } catch (err) {
      console.error("Upload failed:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch("/api/livechat/manifest", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (selectedUploadId === id) {
        setSelectedUploadId(null);
        setLoadedData(null);
        lastLoadedId.current = null;
      }
      lastManifestJson.current = "";
      await refreshManifest();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Upload Sidebar — matches KB document panel width */}
      <div className="w-[360px] border-r border-border flex flex-col bg-bg-elevated">
        <div className="p-3 border-b border-border">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap"
          >
            + Upload CSV
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {uploads.length === 0 && (
            <div className="p-4 text-xs text-text-dim">
              No uploads yet. Upload a CSV file to get started.
            </div>
          )}
          {uploads.map((upload) => (
            <div
              key={upload.id}
              onClick={() => setSelectedUploadId(upload.id)}
              className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                selectedUploadId === upload.id
                  ? "bg-accent/10 border-l-2 border-l-accent"
                  : "hover:bg-bg-hover"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text truncate">
                  {upload.filename}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-text-dim mt-0.5">
                  {upload.conversationCount != null && (
                    <span>
                      {upload.conversationCount.toLocaleString()} convos
                    </span>
                  )}
                  <span
                    className={`px-1 py-0.5 rounded text-[9px] ${
                      upload.status === "ready"
                        ? "bg-accent/10 text-accent"
                        : upload.status === "error"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {upload.status}
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(upload);
                }}
                className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 transition-all p-1"
                title="Delete upload"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-dim text-xs">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin mr-2" />
            Loading data...
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            {activeTab === "stats" && (
              <StatsTab stats={loadedData?.basicStats ?? null} />
            )}
            {activeTab === "transcripts" && (
              <TranscriptsTab data={loadedData?.rawTranscripts ?? null} />
            )}
            {activeTab === "microtopics" && (
              <MicrotopicsTab
                microtopicsData={loadedData?.microtopics ?? null}
                rawData={loadedData?.rawTranscripts ?? null}
              />
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          filename={deleteTarget.filename}
          onConfirm={() => {
            handleDelete(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
