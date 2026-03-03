"use client";

import { useState, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface FileUploaderProps {
  kbId: Id<"knowledgeBases">;
}

export function FileUploader({ kbId }: FileUploaderProps) {
  const generateUploadUrl = useMutation(api.crud.documents.generateUploadUrl);
  const createDocument = useMutation(api.crud.documents.create);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadStatus(null);
    let success = 0;
    let failed = 0;

    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".md") && !file.name.endsWith(".txt")) {
        failed++;
        continue;
      }

      try {
        // Get upload URL
        const url = await generateUploadUrl();

        // Upload file to Convex storage
        const result = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "text/plain" },
          body: file,
        });

        if (!result.ok) {
          failed++;
          continue;
        }

        const { storageId } = await result.json();

        // Read file content on the client (mutations can't use fetch())
        const content = await file.text();

        // Create document record
        await createDocument({
          kbId,
          storageId: storageId as Id<"_storage">,
          title: file.name,
          content,
        });

        success++;
      } catch {
        failed++;
      }
    }

    setUploading(false);
    setUploadStatus(
      `Uploaded ${success} file${success !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""}`,
    );

    // Clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Clear status after a few seconds
    setTimeout(() => setUploadStatus(null), 3000);
  }

  return (
    <div className="space-y-2">
      <label className="text-xs text-text-muted uppercase tracking-wide">
        Upload Documents
      </label>

      <div
        className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-accent/50 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("border-accent/50");
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove("border-accent/50");
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("border-accent/50");
          handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.txt"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-text-dim text-sm">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            Uploading...
          </div>
        ) : (
          <div className="text-text-dim text-xs">
            <p>Drop .md files here or click to browse</p>
          </div>
        )}
      </div>

      {uploadStatus && (
        <p className="text-xs text-accent animate-fade-in">{uploadStatus}</p>
      )}
    </div>
  );
}
