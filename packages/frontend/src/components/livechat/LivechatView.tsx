"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TabBar } from "./TabBar";
import { StatsTab } from "./StatsTab";
import { TranscriptsTab } from "./TranscriptsTab";
import { MicrotopicsTab } from "./MicrotopicsTab";
import type { LivechatTab, UploadEntry, LoadedData } from "./types";

export function LivechatView() {
  const [activeTab, setActiveTab] = useState<LivechatTab>("stats");
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [loadedData, setLoadedData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll manifest for upload status
  const refreshManifest = useCallback(async () => {
    try {
      const res = await fetch("/api/livechat/manifest");
      if (res.ok) {
        const data = await res.json();
        setUploads(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshManifest();
    const interval = setInterval(refreshManifest, 3000);
    return () => clearInterval(interval);
  }, [refreshManifest]);

  // Load data when selecting an upload
  useEffect(() => {
    if (!selectedUploadId) {
      setLoadedData(null);
      return;
    }
    const upload = uploads.find((u) => u.id === selectedUploadId);
    if (!upload || upload.status !== "ready") {
      setLoadedData(null);
      return;
    }

    setLoading(true);
    Promise.all([
      fetch(`/api/livechat/data/${selectedUploadId}?type=basicStats`).then((r) => r.json()),
      fetch(`/api/livechat/data/${selectedUploadId}?type=rawTranscripts`).then((r) => r.json()),
      fetch(`/api/livechat/data/${selectedUploadId}?type=microtopics`).then((r) => r.json()),
    ])
      .then(([basicStats, rawTranscripts, microtopics]) => {
        setLoadedData({ basicStats, rawTranscripts, microtopics });
      })
      .catch(() => setLoadedData(null))
      .finally(() => setLoading(false));
  }, [selectedUploadId, uploads]);

  async function handleUpload(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      await fetch("/api/livechat/upload", { method: "POST", body: formData });
      await refreshManifest();
    } catch (err) {
      console.error("Upload failed:", err);
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Upload Sidebar */}
      <div className="w-[180px] border-r border-border flex flex-col">
        <div className="p-2 border-b border-border">
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
            className="w-full text-xs bg-accent-dim text-accent-bright rounded px-2 py-1.5 hover:bg-accent-dim/80 transition-colors"
          >
            + Upload CSV
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {uploads.length === 0 && (
            <div className="text-text-dim text-xs p-3 text-center">
              No uploads yet
            </div>
          )}
          {uploads.map((upload) => (
            <button
              key={upload.id}
              onClick={() => setSelectedUploadId(upload.id)}
              className={`w-full text-left p-2 rounded text-xs mb-0.5 ${
                selectedUploadId === upload.id
                  ? "bg-bg-surface border-l-2 border-accent text-accent"
                  : "text-text-muted hover:bg-bg-hover"
              }`}
            >
              <div className="truncate text-[10px]">{upload.filename}</div>
              <div className="text-text-dim text-[9px] mt-0.5">
                {upload.status === "ready" && upload.conversationCount
                  ? `${upload.conversationCount.toLocaleString()} convos · Ready`
                  : upload.status === "error"
                    ? "Error"
                    : upload.status}
              </div>
            </button>
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
    </div>
  );
}
