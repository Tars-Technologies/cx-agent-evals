"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Header } from "@/components/Header";
import { useUIMessages } from "@convex-dev/agent/react";
import type { Id } from "@convex/_generated/dataModel";

export default function AgentPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex flex-col">
      <Header mode="agent" />
      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 3.5rem)" }}>
        {/* Thread sidebar */}
        <ThreadSidebar
          selectedThreadId={selectedThreadId}
          onSelectThread={setSelectedThreadId}
        />
        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedThreadId ? (
            <ChatView threadId={selectedThreadId} />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Thread Sidebar ───

function ThreadSidebar({
  selectedThreadId,
  onSelectThread,
}: {
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
}) {
  const threads = useQuery(api.agent.threads.listThreads);
  const [showNewThread, setShowNewThread] = useState(false);

  return (
    <aside className="w-64 border-r border-border bg-bg-elevated/50 flex flex-col shrink-0">
      <div className="p-3 border-b border-border">
        <button
          onClick={() => setShowNewThread(true)}
          className="w-full px-3 py-2 text-xs font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors cursor-pointer"
        >
          + New Chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads?.map((thread) => (
          <button
            key={thread.threadId}
            onClick={() => onSelectThread(thread.threadId)}
            className={`w-full text-left px-3 py-2.5 text-xs border-b border-border/50 transition-colors cursor-pointer ${
              selectedThreadId === thread.threadId
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:bg-bg-elevated hover:text-text"
            }`}
          >
            <div className="truncate font-medium">
              {thread.title ?? "Untitled"}
            </div>
            <div className="text-text-dim text-[10px] mt-0.5">
              {thread.kbConfigs.length} KB{thread.kbConfigs.length !== 1 ? "s" : ""}
            </div>
          </button>
        ))}
        {threads && threads.length === 0 && (
          <div className="px-3 py-4 text-[10px] text-text-dim text-center">
            No conversations yet
          </div>
        )}
      </div>
      {showNewThread && (
        <NewThreadDialog
          onClose={() => setShowNewThread(false)}
          onCreated={(threadId) => {
            setShowNewThread(false);
            onSelectThread(threadId);
          }}
        />
      )}
    </aside>
  );
}

// ─── New Thread Dialog ───

function NewThreadDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (threadId: string) => void;
}) {
  const knowledgeBases = useQuery(api.knowledgeBases.list);
  const createThread = useMutation(api.agent.threads.createThread);
  const [selectedKBs, setSelectedKBs] = useState<Set<Id<"knowledgeBases">>>(
    new Set(),
  );
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const toggleKB = (kbId: Id<"knowledgeBases">) => {
    setSelectedKBs((prev) => {
      const next = new Set(prev);
      if (next.has(kbId)) next.delete(kbId);
      else next.add(kbId);
      return next;
    });
  };

  const handleCreate = async () => {
    if (selectedKBs.size === 0) return;
    setCreating(true);
    try {
      const { threadId } = await createThread({
        title: title || undefined,
        kbConfigs: Array.from(selectedKBs).map((kbId) => ({
          kbId,
          retrieverConfig: undefined,
        })),
      });
      onCreated(threadId);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-bg-elevated border border-border rounded-lg p-5 w-96 max-h-[80vh] flex flex-col">
        <h2 className="text-sm font-semibold text-text mb-3">New Chat</h2>

        <input
          type="text"
          placeholder="Chat title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 text-xs bg-bg border border-border rounded mb-3 text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />

        <div className="text-xs text-text-muted mb-2">
          Select knowledge bases:
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 mb-3">
          {knowledgeBases?.map((kb) => (
            <label
              key={kb._id}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedKBs.has(kb._id)}
                onChange={() => toggleKB(kb._id)}
                className="accent-accent"
              />
              <span className="text-xs text-text">{kb.name}</span>
              {kb.description && (
                <span className="text-[10px] text-text-dim truncate">
                  — {kb.description}
                </span>
              )}
            </label>
          ))}
          {knowledgeBases?.length === 0 && (
            <div className="text-xs text-text-dim px-2">
              No knowledge bases found. Create one first.
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={selectedKBs.size === 0 || creating}
            className="px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {creating ? "Creating..." : "Start Chat"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chat View ───

function ChatView({ threadId }: { threadId: string }) {
  const threadConfig = useQuery(api.agent.threads.getThreadConfig, {
    threadId,
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* KB badges bar */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-text-dim">KBs:</span>
        {threadConfig?.kbConfigs.map((kc) => (
          <KBBadge key={String(kc.kbId)} kbId={kc.kbId} />
        ))}
      </div>

      {/* Messages */}
      <MessageList threadId={threadId} />

      {/* Input */}
      <MessageInput threadId={threadId} />
    </div>
  );
}

function KBBadge({ kbId }: { kbId: Id<"knowledgeBases"> }) {
  const kb = useQuery(api.knowledgeBases.get, { id: kbId });
  return (
    <span className="px-2 py-0.5 text-[10px] font-medium bg-accent/10 text-accent rounded">
      {kb?.name ?? "..."}
    </span>
  );
}

// ─── Message List with Streaming ───

function MessageList({ threadId }: { threadId: string }) {
  const { results, status } = useUIMessages(
    api.agent.threads.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true },
  );

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results.length]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {status === "LoadingFirstPage" && (
        <div className="text-xs text-text-dim text-center py-8">
          Loading messages...
        </div>
      )}

      {results.length === 0 && status !== "LoadingFirstPage" && (
        <div className="text-xs text-text-dim text-center py-8">
          Send a message to start the conversation.
        </div>
      )}

      {results.map((message) => (
        <MessageBubble key={message.key} message={message} />
      ))}

      <div ref={bottomRef} />
    </div>
  );
}

// ─── Message Bubble ───

function MessageBubble({ message }: { message: any }) {
  if (message.role === "system") return null;

  const isUser = message.role === "user";
  const parts = message.parts ?? [];

  // Extract text and tool parts from the message
  const textParts = parts.filter((p: any) => p.type === "text");
  const toolParts = parts.filter(
    (p: any) => p.type?.startsWith("tool-") || p.type === "tool-invocation",
  );

  const textContent = textParts.map((p: any) => p.text ?? "").join("").trim();

  // Fallback: if no parts, use message.text directly (handles simpler message shapes)
  const displayText = textContent || message.text || "";

  // If the message is only tool calls with no text, render just the sources
  if (!displayText && toolParts.length > 0) {
    return (
      <div className="space-y-1">
        {toolParts.map((part: any, i: number) =>
          part.toolOutput || part.output || part.result ? (
            <SourceSection
              key={i}
              content={String(part.toolOutput ?? part.output ?? part.result ?? "")}
            />
          ) : null,
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {displayText && (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[75%] px-3 py-2 rounded-lg text-xs leading-relaxed whitespace-pre-wrap ${
              isUser
                ? "bg-accent/15 text-accent"
                : "bg-bg-elevated text-text border border-border/50"
            }`}
          >
            {displayText}
          </div>
        </div>
      )}
      {!displayText && !isUser && (
        <div className="flex justify-start">
          <div className="max-w-[75%] px-3 py-2 rounded-lg text-xs bg-bg-elevated border border-border/50">
            <span className="text-text-dim italic animate-pulse">Thinking...</span>
          </div>
        </div>
      )}
      {toolParts.map((part: any, i: number) =>
        part.toolOutput || part.output || part.result ? (
          <SourceSection
            key={i}
            content={String(part.toolOutput ?? part.output ?? part.result ?? "")}
          />
        ) : null,
      )}
    </div>
  );
}

// ─── Source Section (collapsible retrieved chunks) ───

function SourceSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!content || content.includes("No relevant results")) return null;

  const chunks = content.split("---").filter((c) => c.trim());

  return (
    <div className="ml-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-text-dim hover:text-text-muted transition-colors flex items-center gap-1 cursor-pointer"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>Sources ({chunks.length})</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {chunks.map((chunk, i) => (
            <div
              key={i}
              className="px-2 py-1.5 text-[10px] bg-bg border border-border/50 rounded text-text-muted leading-relaxed"
            >
              {chunk.trim().slice(0, 300)}
              {chunk.trim().length > 300 && "..."}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Message Input ───

function MessageInput({ threadId }: { threadId: string }) {
  const sendMessage = useMutation(api.agent.threads.sendMessage);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      await sendMessage({ threadId, content: text });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-border p-3 shrink-0">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Ask a question..."
          className="flex-1 px-3 py-2 text-xs bg-bg border border-border rounded text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="px-4 py-2 text-xs font-medium bg-accent text-bg rounded hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

// ─── Empty State ───

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="text-sm text-text-muted mb-1">No chat selected</div>
        <div className="text-xs text-text-dim">
          Create a new chat or select an existing one
        </div>
      </div>
    </div>
  );
}
