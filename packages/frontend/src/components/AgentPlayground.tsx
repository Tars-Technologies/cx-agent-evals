"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { groupMessagesWithToolCalls } from "@/lib/messageDisplay";
import { ToolCallGroup } from "@/components/conversation-sim/ToolCallGroup";

interface AgentPlaygroundProps {
  agentId: Id<"agents">;
}

export default function AgentPlayground({ agentId }: AgentPlaygroundProps) {
  const [conversationId, setConversationId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [rawMode, setRawMode] = useState(false);

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
    // Create a fresh playground conversation immediately
    const newId = await getOrCreate({ agentId });
    setConversationId(newId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !streamingMessage) {
      e.preventDefault();
      handleSend();
    }
  };

  const displayItems = groupMessagesWithToolCalls(messages);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sticky header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between flex-shrink-0">
        <span className="text-sm text-text font-semibold">Playground</span>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center bg-bg-surface border border-border rounded-full text-[10px] overflow-hidden">
            <button
              onClick={() => setRawMode(false)}
              className={`px-2 py-0.5 transition-colors ${!rawMode ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text"}`}
            >
              Rendered
            </button>
            <button
              onClick={() => setRawMode(true)}
              className={`px-2 py-0.5 transition-colors ${rawMode ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text"}`}
            >
              Raw
            </button>
          </div>
          <button
            onClick={handleClear}
            className="text-[10px] text-text-dim hover:text-text-muted transition-colors"
          >
            Clear chat
          </button>
        </div>
      </div>

      {/* Scrollable message area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {displayItems.length === 0 && (
          <div className="text-center text-text-dim text-xs mt-12">
            Send a message to start testing your agent.
          </div>
        )}

        {displayItems.map((item) => {
          if (item.type === "user") {
            return (
              <div key={item.msg._id} className="flex justify-end">
                <div className="max-w-[80%] bg-accent/10 border border-accent/20 rounded-xl px-3 py-2">
                  <p className="text-sm text-text whitespace-pre-wrap">{item.msg.content}</p>
                </div>
              </div>
            );
          }

          if (item.type === "tool_group") {
            return <ToolCallGroup key={item.key} calls={item.calls} isLive={!!streamingMessage} />;
          }

          if (item.type === "assistant") {
            const msg = item.msg;
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
                    ) : isError ? (
                      <p className="text-sm whitespace-pre-wrap text-red-400">{displayContent}</p>
                    ) : rawMode ? (
                      <p className="text-sm whitespace-pre-wrap text-text">
                        {displayContent}
                        {isStreaming && !isStuck && (
                          <span className="inline-block w-1.5 h-3 bg-accent animate-pulse rounded-sm ml-0.5 align-middle" />
                        )}
                      </p>
                    ) : (
                      <div className="text-sm text-text prose-agent">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {displayContent || ""}
                        </ReactMarkdown>
                        {isStreaming && !isStuck && (
                          <span className="inline-block w-1.5 h-3 bg-accent animate-pulse rounded-sm ml-0.5 align-middle" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Sticky input area */}
      <div className="p-3 border-t border-border flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-accent/50 focus:outline-none"
            disabled={!conversationId}
          />
          <div className="relative group">
            <button
              onClick={handleSend}
              disabled={sending || !input.trim() || !conversationId || !!streamingMessage}
              className="bg-accent text-bg px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              Send
            </button>
            {streamingMessage && (
              <div className="absolute bottom-full right-0 mb-1.5 px-2.5 py-1.5 bg-bg-elevated border border-border rounded-md text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                Waiting for response to complete...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
