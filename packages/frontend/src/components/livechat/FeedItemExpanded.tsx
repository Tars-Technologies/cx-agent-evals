"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export function FeedItemExpanded({
  conversationId,
  messageId,
  originalText,
  standaloneVersion,
  isFollowUp,
  precedingMessages,
  onClose,
}: {
  conversationId: Id<"livechatConversations">;
  messageId: number;
  originalText: string;
  standaloneVersion?: string;
  isFollowUp: boolean;
  precedingMessages: Array<{ id: number; role: string; text: string }>;
  onClose: () => void;
}) {
  const [editText, setEditText] = useState(standaloneVersion ?? originalText);
  const patchStandalone = useMutation(api.livechat.orchestration.patchStandaloneVersion);

  async function handleSave() {
    await patchStandalone({ conversationId, messageId, standaloneVersion: editText });
    onClose();
  }

  return (
    <div className="border-t border-border bg-bg-elevated p-3">
      {/* Preceding context */}
      <div className="text-[8px] uppercase tracking-wider text-text-dim mb-2">Preceding context</div>
      <div className="space-y-1 mb-3">
        {precedingMessages.map((msg) => (
          <div
            key={msg.id}
            className={`text-[11px] px-2 py-1 rounded ${
              msg.role === "user"
                ? "bg-accent-dim/30 text-accent-bright border border-accent/10"
                : "bg-bg-surface text-text-muted border border-border"
            }`}
          >
            <div className="text-[8px] text-text-dim mb-0.5">
              {msg.role === "user" ? "User" : "Agent"} · #{msg.id}
            </div>
            {msg.text}
          </div>
        ))}
      </div>

      {/* Original message */}
      <div className="border-t border-dashed border-border pt-2 mb-2">
        <div className="text-[8px] uppercase tracking-wider text-text-dim mb-1">Original message</div>
        <div className="text-[11px] text-accent-bright bg-accent-dim/20 border border-accent/10 rounded px-2 py-1">
          {originalText}
        </div>
      </div>

      {/* Edit standalone (only for follow-ups) */}
      {isFollowUp && (
        <div className="border-t border-border pt-2 mt-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[8px] uppercase tracking-wider text-accent">Standalone version (editable)</span>
            <span className="text-[7px] text-accent uppercase">AI-generated</span>
          </div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded px-2 py-1.5 text-xs text-accent-bright font-inherit resize-y min-h-[36px] outline-none focus:border-accent"
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <button onClick={onClose} className="px-2 py-0.5 rounded text-[9px] border border-border text-text-dim hover:text-text">Cancel</button>
            <button onClick={handleSave} className="px-2 py-0.5 rounded text-[9px] bg-accent text-bg font-medium hover:opacity-90">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
