"use client";

import { useState } from "react";
import { TabBar } from "./TabBar";
import type { LivechatTab, UploadEntry, LoadedData } from "./types";

export function LivechatView() {
  const [activeTab, setActiveTab] = useState<LivechatTab>("stats");
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [loadedData, setLoadedData] = useState<LoadedData | null>(null);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Upload Sidebar */}
      <div className="w-[180px] border-r border-border flex flex-col">
        <div className="p-2 border-b border-border">
          <button className="w-full text-xs bg-accent-dim text-accent-bright rounded px-2 py-1.5 hover:bg-accent-dim/80 transition-colors">
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
              <div className="truncate">{upload.filename}</div>
              <div className="text-text-dim text-[10px] mt-0.5">
                {upload.conversationCount
                  ? `${upload.conversationCount.toLocaleString()} convos`
                  : upload.status}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1 overflow-hidden">
          {activeTab === "stats" && (
            <div className="p-4 text-text-dim text-xs">
              Stats tab — select an upload to view
            </div>
          )}
          {activeTab === "transcripts" && (
            <div className="p-4 text-text-dim text-xs">
              Transcripts tab — select an upload to view
            </div>
          )}
          {activeTab === "microtopics" && (
            <div className="p-4 text-text-dim text-xs">
              Microtopics tab — select an upload to view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
