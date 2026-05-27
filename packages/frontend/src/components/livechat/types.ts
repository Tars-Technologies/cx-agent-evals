import type {
  BasicStats,
  Exchange,
  ExtractedInfo,
  MessageType,
  MessageTypeCategory,
  RawTranscriptsFile
} from "@tars-inc/eval-lib/data-analysis"

export type LivechatTab = "stats" | "conversations"

export type UploadStatus =
  | "pending"
  | "parsing"
  | "ready"
  | "failed"
  | "deleting"

export type ClassificationStatus = "none" | "running" | "done" | "failed"
export type TranslationStatus = "none" | "running" | "done" | "failed"

export interface MessageTypeItem {
  conversationId: string
  visitorName: string
  agentName: string
  language: string
  messageType: MessageType
}

export type MessagesByType = Map<MessageTypeCategory, MessageTypeItem[]>

export type {
  BasicStats,
  Exchange,
  ExtractedInfo,
  MessageType,
  MessageTypeCategory,
  RawTranscriptsFile
}
