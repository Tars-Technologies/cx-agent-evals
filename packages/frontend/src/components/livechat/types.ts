import type {
  RawTranscriptsFile,
  BasicStats,
  MessageTypeCategory,
  MessageType,
  Exchange,
  ExtractedInfo,
} from "rag-evaluation-system/data-analysis";

export type LivechatTab = "stats" | "conversations";

export type UploadStatus = "pending" | "parsing" | "ready" | "failed" | "deleting";

export type ClassificationStatus = "none" | "running" | "done" | "failed";
export type TranslationStatus = "none" | "running" | "done" | "failed";

export interface MessageTypeItem {
  conversationId: string;
  visitorName: string;
  agentName: string;
  language: string;
  messageType: MessageType;
}

export type MessagesByType = Map<MessageTypeCategory, MessageTypeItem[]>;

export type {
  RawTranscriptsFile,
  BasicStats,
  MessageTypeCategory,
  MessageType,
  Exchange,
  ExtractedInfo,
};

export interface ClassifiedMessage {
  messageId: number;
  label: string;
  intentOpenCode?: string;
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: "clarification" | "correction" | "feedback";
  standaloneVersion?: string;
  source: "llm" | "human";
}

export interface ConversationBlock {
  label: string;
  intentOpenCode?: string;
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: "clarification" | "correction" | "feedback";
  standaloneVersion?: string;
  messageIds: number[];
}

export const TEMPLATE_OPTIONS = [
  { id: "cx-transcript-analysis", name: "CX Transcript Analysis" },
  { id: "eval-dataset-extraction", name: "Eval Dataset Extraction" },
] as const;
