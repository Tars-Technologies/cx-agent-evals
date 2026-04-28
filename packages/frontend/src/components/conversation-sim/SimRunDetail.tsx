"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { groupMessagesWithToolCalls } from "@/lib/messageDisplay";
import { ToolCallGroup } from "@/components/conversation-sim/ToolCallGroup";

export function SimRunDetail({
  runId,
}: {
  runId: Id<"conversationSimRuns">;
}) {
  const run = useQuery(api.conversationSim.runs.get, { id: runId });

  // Load conversation messages if run has a conversationId
  const messages = useQuery(
    api.crud.conversations.listMessages,
    run?.conversationId ? { conversationId: run.conversationId } : "skip",
  ) ?? [];

  if (!run) {
    return <div className="flex items-center justify-center h-full text-text-dim text-xs">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border bg-bg-elevated/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
            run.status === "completed"
              ? run.passed == null
                ? "bg-green-500/15 text-green-400"
                : run.passed
                  ? "bg-green-500/15 text-green-400"
                  : "bg-red-500/15 text-red-400"
              : run.status === "running"
                ? "bg-accent/15 text-accent"
                : run.status === "failed"
                  ? "bg-red-500/15 text-red-400"
                  : "bg-yellow-500/15 text-yellow-400"
          }`}>
            {run.status === "completed"
              ? run.passed == null
                ? "DONE"
                : run.passed
                  ? "PASS"
                  : "FAIL"
              : run.status.toUpperCase()}
          </span>
          {run.score != null && (
            <span className="text-xs text-text-dim">Score: {(run.score * 100).toFixed(0)}%</span>
          )}
          {run.turnCount != null && (
            <span className="text-xs text-text-dim">{run.turnCount} turns</span>
          )}
          {run.latencyMs != null && (
            <span className="text-xs text-text-dim">{(run.latencyMs / 1000).toFixed(1)}s</span>
          )}
        </div>
        {run.terminationReason && (
          <span className="text-[10px] text-text-dim">
            Ended: {run.terminationReason.replace("_", " ")}
          </span>
        )}
      </div>

      {/* Content: transcript + evaluation */}
      <div className="flex-1 overflow-y-auto">
        {/* Conversation transcript */}
        <div className="px-4 py-3 space-y-3">
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider">Transcript</h3>
          {groupMessagesWithToolCalls(messages).map((item) => {
            if (item.type === "tool_group") {
              return <ToolCallGroup key={item.key} calls={item.calls} isLive={false} />;
            }
            const msg = item.msg;
            return (
              <div
                key={msg._id}
                className={`rounded-md p-3 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-500/10 border border-blue-500/20 text-text"
                    : "bg-bg-elevated border border-border text-text-dim"
                }`}
              >
                <div className={`text-[10px] font-medium mb-1 uppercase ${
                  msg.role === "user" ? "text-blue-400" : "text-accent"
                }`}>
                  {msg.role === "user" ? "User" : "Agent"}
                </div>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            );
          })}
        </div>

        {/* Evaluation Results */}
        {run.evaluatorResults && run.evaluatorResults.length > 0 && (
          <div className="px-4 py-3 border-t border-border">
            <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">
              Evaluation ({run.evaluatorResults.filter(r => r.passed).length}/{run.evaluatorResults.length} passed)
            </h3>
            <div className="space-y-2">
              {run.evaluatorResults.map((result, i) => (
                <div
                  key={i}
                  className={`rounded-md p-2.5 border text-xs ${
                    result.passed
                      ? "bg-green-500/5 border-green-500/20"
                      : "bg-red-500/5 border-red-500/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text">
                      {result.evaluatorName}
                      {result.required && <span className="text-accent ml-1">*</span>}
                    </span>
                    <span className={`text-[10px] font-medium ${result.passed ? "text-green-400" : "text-red-400"}`}>
                      {result.passed ? "PASS" : "FAIL"}
                    </span>
                  </div>
                  <p className="text-text-dim mt-1">{result.justification}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
