// ── Roles ──
export type MessageRole = "user" | "human_agent" | "workflow_input";

// ── JSON 1: Raw Transcripts ──
export interface RawMessage {
  id: number;
  role: MessageRole;
  text: string;
}

export interface RawConversation {
  conversationId: string;
  visitorId: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail: string;
  agentId: string;
  agentName: string;
  agentEmail: string;
  inbox: string;
  labels: string[];
  status: string;
  messages: RawMessage[];
  metadata: {
    messageCountVisitor: number;
    messageCountAgent: number;
    totalDurationSeconds: number;
    startDate: string;
    startTime: string;
    replyDate: string;
    replyTime: string;
    lastActivityDate: string;
    lastActivityTime: string;
  };
}

export interface RawTranscriptsFile {
  source: string;
  generatedAt: string;
  totalConversations: number;
  conversations: RawConversation[];
}

// ── JSON 2: Microtopics ──
export type MicrotopicType =
  | "identity_info"
  | "question"
  | "request"
  | "confirmation"
  | "greeting"
  | "closing"
  | "uncategorized";

export interface MicrotopicMessage {
  id: number;
  role: MessageRole;
  text: string;
}

export interface Exchange {
  label: "primary" | "follow_up";
  messages: MicrotopicMessage[];
}

export interface ExtractedInfo {
  type: string;
  value: string;
}

export interface Microtopic {
  type: MicrotopicType;
  exchanges: Exchange[];
  extracted?: ExtractedInfo[];
}

export interface BotFlowInput {
  rawText: string;
  intent: string;
  language: string;
  messageIds: number[];
}

export interface ConversationMicrotopics {
  conversationId: string;
  language: string;
  botFlowInput?: BotFlowInput;
  microtopics: Microtopic[];
}

export interface MicrotopicsFile {
  source: string;
  generatedAt: string;
  model: string;
  totalConversations: number;
  processedConversations: number;
  failures: string[];
  conversations: ConversationMicrotopics[];
}

// ── LLM Output (ID-only, no text) ──
export interface LLMExchangeResult {
  label: "primary" | "follow_up";
  messageIds: number[];
}

export interface LLMMicrotopicResult {
  type: MicrotopicType;
  exchanges: LLMExchangeResult[];
  extracted?: ExtractedInfo[];
}

export interface LLMExtractionResult {
  microtopics: LLMMicrotopicResult[];
}

// ── JSON 3: Basic Stats ──
export interface AgentStats {
  agentName: string;
  agentEmail: string;
  conversationCount: number;
  totalMessagesFromAgent: number;
}

export interface BasicStats {
  source: string;
  generatedAt: string;
  totalConversations: number;
  conversationsWithUserMessages: number;
  conversationsWithoutUserMessages: number;
  uniqueVisitors: number;
  uniqueAgents: number;
  statusBreakdown: Record<string, number>;
  labelBreakdown: Record<string, number>;
  agentBreakdown: AgentStats[];
  visitorStats: {
    avgMessagesPerConversation: number;
    medianMessagesPerConversation: number;
  };
  agentStats: {
    avgMessagesPerConversation: number;
    medianMessagesPerConversation: number;
  };
  durationStats: {
    avgDurationSeconds: number;
    medianDurationSeconds: number;
    minDurationSeconds: number;
    maxDurationSeconds: number;
  };
  timeRange: {
    earliestStart: string;
    latestStart: string;
  };
}

// ── Export Format (frontend topic type export) ──
export interface TopicTypeExportItem {
  conversationId: string;
  visitorName: string;
  agentName: string;
  language: string;
  exchanges: Exchange[];
  extracted?: ExtractedInfo[];
}

export interface TopicTypeExport {
  type: MicrotopicType;
  exportedAt: string;
  source: string;
  totalItems: number;
  items: TopicTypeExportItem[];
}
