"use client";

import { useState } from "react";

interface ToolCallChipProps {
  toolName: string;
  toolArgs?: string;   // JSON string
  toolResult?: string; // JSON string
}

function prettyJsonOr(s: string | undefined): string {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export default function ToolCallChip({ toolName, toolArgs, toolResult }: ToolCallChipProps) {
  const [expanded, setExpanded] = useState(false);

  const displayName = toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  let parsedArgs: any = {};
  let parsedResult: any = null;
  try { parsedArgs = JSON.parse(toolArgs ?? "{}"); } catch {}
  try { parsedResult = JSON.parse(toolResult ?? "null"); } catch {}

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-bg-elevated border border-border rounded-md text-[9px] hover:border-accent/30 transition-colors"
      >
        <span className="text-accent">&#9889;</span>
        <span className="text-text-muted">
          Searched <strong className="text-text font-medium">{displayName}</strong>
        </span>
        <span className="text-text-dim">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="mt-1 ml-2 p-2.5 bg-bg-elevated border border-border rounded-md text-[9px] animate-fade-in space-y-2">
          {parsedArgs.query && (
            <div>
              <span className="text-text-dim">Query: </span>
              <span className="text-text">&ldquo;{parsedArgs.query}&rdquo;</span>
            </div>
          )}
          {Array.isArray(parsedResult) && parsedResult.length > 0 && parsedResult[0]?.content && (
            <div>
              <span className="text-text-dim">{parsedResult.length} chunk{parsedResult.length !== 1 ? "s" : ""} returned</span>
              <div className="mt-1.5 space-y-1">
                {parsedResult.slice(0, 3).map((chunk: any, i: number) => (
                  <div key={i} className="p-1.5 bg-bg rounded border border-border/50 text-text-muted">
                    <div className="line-clamp-2">{String(chunk.content ?? "").slice(0, 150)}...</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-text-dim mb-1">Input</div>
            <pre className="p-2 bg-bg rounded border border-border/50 text-text whitespace-pre-wrap break-words font-mono text-[9px] max-h-48 overflow-auto">
              {prettyJsonOr(toolArgs)}
            </pre>
          </div>

          <div>
            <div className="text-text-dim mb-1">Output</div>
            <pre className="p-2 bg-bg rounded border border-border/50 text-text whitespace-pre-wrap break-words font-mono text-[9px] max-h-48 overflow-auto">
              {toolResult ? prettyJsonOr(toolResult) : "(no result)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
