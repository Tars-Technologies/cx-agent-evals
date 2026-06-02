"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { TranscriptDetail } from "./TranscriptDetail";

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
        <h3 className="text-sm font-semibold text-text mb-2">Delete upload?</h3>
        <p className="text-xs text-text-muted mb-1">
          This will permanently delete the uploaded CSV and all processed output files for:
        </p>
        <p className="text-xs text-accent mb-3 truncate">{filename}</p>
        <p className="text-xs text-text-dim mb-2">
          Type <span className="text-red-400 font-semibold">delete</span> to confirm.
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

export function TranscriptsPane({ selectedId }: { selectedId?: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<Id<"livechatUploads"> | null>(null);

  const uploads = useQuery(api.livechat.orchestration.list) ?? [];
  const generateUploadUrl = useMutation(api.livechat.orchestration.generateUploadUrl);
  const createUpload = useMutation(api.livechat.orchestration.create);
  const removeUpload = useMutation(api.livechat.orchestration.remove);

  function select(id: string) {
    router.replace(`/conversations?tab=transcripts&id=${id}`, { scroll: false });
  }

  useEffect(() => {
    if (!selectedId && uploads.length > 0) {
      router.replace(`/conversations?tab=transcripts&id=${uploads[0]._id}`, { scroll: false });
    }
  }, [selectedId, uploads, router]);

  async function handleUpload(file: File) {
    try {
      const uploadUrl = await generateUploadUrl({});
      const postRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "text/csv" },
        body: file,
      });
      if (!postRes.ok) throw new Error(`Upload failed with status ${postRes.status}`);
      const { storageId } = (await postRes.json()) as { storageId: string };
      await createUpload({
        filename: file.name,
        csvStorageId: storageId as Id<"_storage">,
      });
    } catch (err) {
      console.error("Upload failed:", err);
    }
  }

  async function handleDelete(id: Id<"livechatUploads">) {
    try {
      await removeUpload({ id });
      if (selectedId === id) router.replace("/conversations?tab=transcripts");
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  const deleteTargetUpload = uploads.find((u) => u._id === deleteTargetId) ?? null;

  return (
    <div className="flex border border-border rounded-lg overflow-hidden flex-1 min-h-0">
      <aside className="w-80 shrink-0 border-r border-border flex flex-col bg-bg-elevated">
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
            className="w-full px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
          >
            + Upload CSV
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {uploads.length === 0 && (
            <div className="p-4 text-xs text-text-dim">
              No uploads yet. Upload a CSV to get started.
            </div>
          )}
          {uploads.map((upload) => {
            const isBusy =
              upload.status === "pending" ||
              upload.status === "parsing" ||
              upload.status === "deleting";
            const isActive = selectedId === upload._id;
            return (
              <div
                key={upload._id}
                role="button"
                tabIndex={0}
                onClick={() => select(upload._id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(upload._id);
                  }
                }}
                className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                  isActive
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-hover"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text truncate">{upload.filename}</div>
                  <div className="flex items-center gap-2 text-[10px] text-text-dim mt-0.5">
                    {upload.conversationCount != null && (
                      <span>{upload.conversationCount.toLocaleString()} convos</span>
                    )}
                    {upload.status === "parsing" && upload.parsedConversations != null ? (
                      <span className="px-1 py-0.5 rounded text-[9px] bg-yellow-500/10 text-yellow-400">
                        parsing {upload.parsedConversations}...
                      </span>
                    ) : (
                      <span
                        className={`px-1 py-0.5 rounded text-[9px] ${
                          upload.status === "ready"
                            ? "bg-accent/10 text-accent"
                            : upload.status === "failed"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-yellow-500/10 text-yellow-400"
                        }`}
                      >
                        {upload.status}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isBusy) setDeleteTargetId(upload._id);
                  }}
                  disabled={isBusy}
                  className={`opacity-0 group-hover:opacity-100 text-text-dim transition-all p-1 ${
                    isBusy ? "cursor-not-allowed" : "hover:text-red-400"
                  }`}
                  title={
                    isBusy
                      ? "Cannot delete while analysis is in progress"
                      : "Delete upload"
                  }
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 min-w-0 bg-bg overflow-hidden flex flex-col">
        {selectedId ? (
          <div className="flex-1 min-h-0">
            <TranscriptDetail uploadId={selectedId as Id<"livechatUploads">} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-text-dim">
            Select a transcript to view its analysis.
          </div>
        )}
      </section>

      {deleteTargetId && deleteTargetUpload && (
        <DeleteConfirmModal
          filename={deleteTargetUpload.filename}
          onConfirm={() => {
            handleDelete(deleteTargetId);
            setDeleteTargetId(null);
          }}
          onCancel={() => setDeleteTargetId(null)}
        />
      )}
    </div>
  );
}
