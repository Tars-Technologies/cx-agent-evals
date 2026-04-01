import type {
  RawTranscriptsFile,
  MicrotopicsFile,
  BasicStats,
  MicrotopicType,
  Microtopic,
} from "rag-evaluation-system/data-analysis";

export type LivechatTab = "stats" | "transcripts" | "microtopics";

export interface UploadEntry {
  id: string;
  filename: string;
  uploadedAt: string;
  status: "pending" | "parsing" | "analyzing" | "ready" | "error";
  conversationCount?: number;
  error?: string;
  outputFiles?: {
    rawTranscripts: string;
    microtopics: string;
    basicStats: string;
  };
}

export interface LoadedData {
  rawTranscripts: RawTranscriptsFile;
  microtopics: MicrotopicsFile;
  basicStats: BasicStats;
}

export interface MicrotopicByTypeItem {
  conversationId: string;
  visitorName: string;
  agentName: string;
  language: string;
  microtopic: Microtopic;
}

export type MicrotopicsByType = Map<MicrotopicType, MicrotopicByTypeItem[]>;

export type { RawTranscriptsFile, MicrotopicsFile, BasicStats, MicrotopicType, Microtopic };
