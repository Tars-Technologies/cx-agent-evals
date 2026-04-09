import type {
  RawTranscriptsFile,
  MicrotopicsFile,
  BasicStats,
  MicrotopicType,
  Microtopic,
} from "rag-evaluation-system/data-analysis";

export type LivechatTab = "stats" | "transcripts" | "microtopics";

// Types mirrored from the Convex row so components don't need
// to import from the backend's _generated types.
export type UploadStatus = "pending" | "parsing" | "ready" | "failed";
export type MicrotopicsStatus =
  | "pending"
  | "running"
  | "ready"
  | "failed"
  | "skipped";

export interface LoadedData {
  basicStats: BasicStats | null;
  rawTranscripts: RawTranscriptsFile | null;
  microtopics: MicrotopicsFile | null;
}

export interface MicrotopicByTypeItem {
  conversationId: string;
  visitorName: string;
  agentName: string;
  language: string;
  microtopic: Microtopic;
}

export type MicrotopicsByType = Map<MicrotopicType, MicrotopicByTypeItem[]>;

export type {
  RawTranscriptsFile,
  MicrotopicsFile,
  BasicStats,
  MicrotopicType,
  Microtopic,
};
