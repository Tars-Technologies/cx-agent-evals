"use client"

import type { Id } from "@convex/_generated/dataModel"
import { useMutation, useQuery } from "convex/react"
import { useRef, useState } from "react"
import { api } from "@/lib/convex"
import { ScraperBackendToggle } from "./ScraperBackendToggle"

interface FileUploaderProps {
  kbId: Id<"knowledgeBases">
}

function mimeTypeFor(file: File): string {
  if (file.type) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith(".pdf")) return "application/pdf"
  if (name.endsWith(".html") || name.endsWith(".htm")) return "text/html"
  if (name.endsWith(".md")) return "text/markdown"
  return "text/plain"
}

export function FileUploader({ kbId }: FileUploaderProps) {
  const generateUploadUrl = useMutation(api.kb.documents.generateUploadUrl)
  const parseUpload = useMutation(api.kb.documents.parseUpload)
  const availability = useQuery(api.kb.providers.getScraperAvailability, {})
  // `undefined` = still loading (don't assert "unavailable"); only a resolved
  // `false` means Tarser is genuinely unavailable.
  const tarserAvailable = availability?.tarser === true
  const availabilityLoading = availability === undefined
  const [backend, setBackend] = useState<"inprocess" | "tarser">("inprocess")
  const [ocr, setOcr] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    setUploading(true)
    setUploadStatus(null)
    let success = 0
    let failed = 0

    for (const file of Array.from(files)) {
      const validExts = [".md", ".txt", ".html", ".htm", ".pdf"]
      if (!validExts.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        failed++
        continue
      }

      try {
        const url = await generateUploadUrl()
        const result = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file
        })
        if (!result.ok) {
          failed++
          continue
        }
        const { storageId } = await result.json()

        // Fall back to native if Tarser became unavailable after selection.
        const resolvedBackend =
          backend === "tarser" && !tarserAvailable ? "inprocess" : backend

        await parseUpload({
          kbId,
          storageId: storageId as Id<"_storage">,
          title: file.name,
          mimeType: mimeTypeFor(file),
          backend: resolvedBackend,
          // OCR only applies to remote (Tarser) parsing.
          ocr: resolvedBackend === "tarser" ? ocr : undefined
        })

        success++
      } catch {
        failed++
      }
    }

    setUploading(false)
    setUploadStatus(
      `Uploaded ${success} file${success !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""}`
    )

    // Clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }

    // Clear status after a few seconds
    setTimeout(() => setUploadStatus(null), 3000)
  }

  return (
    <div className="space-y-2">
      <label className="text-xs text-text-muted uppercase tracking-wide">
        Upload Documents
      </label>

      <ScraperBackendToggle
        value={backend}
        onChange={setBackend}
        tarserAvailable={tarserAvailable}
        loading={availabilityLoading}
        disabled={uploading}
      />

      {backend === "tarser" && tarserAvailable && (
        <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer">
          <input
            type="checkbox"
            checked={ocr}
            onChange={(e) => setOcr(e.target.checked)}
            disabled={uploading}
            className="accent-accent"
          />
          Enable OCR (scanned PDFs and images)
        </label>
      )}

      <div
        className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-accent/50 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          e.currentTarget.classList.add("border-accent/50")
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove("border-accent/50")
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.currentTarget.classList.remove("border-accent/50")
          handleFiles(e.dataTransfer.files)
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.txt,.html,.htm,.pdf"
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
            <p>Drop .md, .html, or .pdf files here or click to browse</p>
          </div>
        )}
      </div>

      {uploadStatus && (
        <p className="text-xs text-accent animate-fade-in">{uploadStatus}</p>
      )}
    </div>
  )
}
