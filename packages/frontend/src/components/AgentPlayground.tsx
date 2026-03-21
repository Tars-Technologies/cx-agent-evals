"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import ToolCallChip from "@/components/ToolCallChip";

interface AgentPlaygroundProps {
  agentId: Id<"agents">;
}

export default function AgentPlayground({ agentId }: AgentPlaygroundProps) {
  const [conversationId, setConversationId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const getOrCreate = useMutation(api.agents.orchestration.getOrCreatePlayground);
  const send = useMutation(api.agents.orchestration.sendMessage);
  const clear = useMutation(api.agents.orchestration.clearPlayground);

  const initRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset conversation when agent changes
  useEffect(() => {
    if (initRef.current === agentId) return;
    initRef.current = agentId;
    setConversationId(null);
    getOrCreate({ agentId }).then(setConversationId);
  }, [agentId, getOrCreate]);

  // Subscribe to messages
  const messages = useQuery(
    api.crud.conversations.listMessages,
    conversationId ? { conversationId } : "skip",
  ) ?? [];

  // Find streaming message
  const streamingMessage = messages.find((m) => m.status === "streaming");

  // Subscribe to stream deltas
  const deltas = useQuery(
    api.crud.conversations.getStreamDeltas,
    streamingMessage ? { messageId: streamingMessage._id } : "skip",
  ) ?? [];

  // Reconstruct streamed text from deltas
  const streamedText = deltas.length > 0
    ? [...deltas].sort((a, b) => a.start - b.start).map((d) => d.text).join("")
    : "";

  // Detect stuck streaming messages (no deltas for 30s)
  const [stuckMessageId, setStuckMessageId] = useState<string | null>(null);
  useEffect(() => {
    if (!streamingMessage || deltas.length > 0) {
      setStuckMessageId(null);
      return;
    }
    const timer = setTimeout(() => {
      setStuckMessageId(streamingMessage._id);
    }, 30000);
    return () => clearTimeout(timer);
  }, [streamingMessage?._id, deltas.length]);

  // Auto-scroll on message changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamedText]);

  const handleSend = async () => {
    if (!input.trim() || !conversationId || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    try {
      await send({ conversationId, agentId, content });
    } finally {
      setSending(false);
    }
  };

  const handleClear = async () => {
    if (!conversationId) return;
    await clear({ conversationId });
    setConversationId(null);
    initRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Build a map of toolCallId -> tool_result message for pairing
  const toolResultMap = new Map<string, typeof messages[number]>();
  for (const m of messages) {
    if (m.role === "tool_result" && m.toolResult?.toolCallId) {
      toolResultMap.set(m.toolResult.toolCallId, m);
    }
  }

  // Filter out tool_result messages (they are displayed inline with their tool_call)
  const visibleMessages = messages.filter((m) => m.role !== "tool_result");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <span className="text-sm text-text-muted">Playground</span>
        <button
          onClick={handleClear}
          className="text-[9px] text-text-dim hover:text-text-muted transition-colors"
        >
          Clear chat
        </button>
      </div>

      {/* Message area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {visibleMessages.length === 0 && (
          <div className="text-center text-text-dim text-xs mt-12">
            Send a message to start testing your agent.
          </div>
        )}

        {visibleMessages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg._id} className="flex justify-end">
                <div className="max-w-[80%] bg-accent/10 border border-accent/20 rounded-xl px-3 py-2">
                  <p className="text-sm text-text whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            );
          }

          if (msg.role === "tool_call") {
            const result = msg.toolCall?.toolCallId
              ? toolResultMap.get(msg.toolCall.toolCallId)
              : undefined;
            return (
              <div key={msg._id} className="flex justify-start">
                <div className="max-w-[80%]">
                  <ToolCallChip
                    toolName={msg.toolCall?.toolName ?? "tool"}
                    toolArgs={msg.toolCall?.toolArgs}
                    toolResult={result?.toolResult?.result}
                  />
                </div>
              </div>
            );
          }

          if (msg.role === "assistant") {
            const isStreaming = msg.status === "streaming";
            const isStuck = stuckMessageId === msg._id;
            const isError = msg.status === "error";
            const displayContent = isStreaming ? streamedText : msg.content;

            return (
              <div key={msg._id} className="flex justify-start">
                <div className="max-w-[80%]">
                  <div className="text-text-dim text-[8px] mb-0.5 ml-1">Agent</div>
                  <div className={`bg-bg-elevated border rounded-xl px-3 py-2 ${isError ? "border-red-500/30" : "border-border"}`}>
                    {isStuck && !displayContent ? (
                      <p className="text-sm text-red-400">
                        Agent is not responding. Check that ANTHROPIC_API_KEY (or OPENAI_API_KEY for OpenAI models) is set in Convex dashboard environment variables.
                      </p>
                    ) : (
                      <p className={`text-sm whitespace-pre-wrap ${isError ? "text-red-400" : "text-text"}`}>
                        {displayContent}
                        {isStreaming && !isStuck && (
                          <span className="inline-block w-1.5 h-3 bg-accent animate-pulse rounded-sm ml-0.5 align-middle" />
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent/50 focus:outline-none"
            disabled={sending || !conversationId}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim() || !conversationId}
            className="bg-accent text-bg px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
