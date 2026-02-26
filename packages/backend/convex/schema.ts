import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Shared validator for CharacterSpan-shaped objects
const spanValidator = v.object({
  docId: v.string(),
  start: v.number(),
  end: v.number(),
  text: v.string(),
});

export default defineSchema({
  // ─── Users (synced from Clerk) ───
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_clerk_id", ["clerkId"]),

  // ─── Knowledge Bases (org-scoped, replaces "corpora") ───
  knowledgeBases: defineTable({
    orgId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    metadata: v.any(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // ─── Documents (markdown files in a knowledge base) ───
  documents: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    docId: v.string(),
    title: v.string(),
    content: v.string(),
    fileId: v.id("_storage"),
    contentLength: v.number(),
    metadata: v.any(),
    createdAt: v.number(),
  })
    .index("by_kb", ["kbId"])
    .index("by_org", ["orgId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["kbId"],
    }),

  // ─── Datasets (sets of generated questions) ───
  datasets: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    name: v.string(),
    strategy: v.string(),
    strategyConfig: v.any(),
    questionCount: v.number(),
    langsmithDatasetId: v.optional(v.string()),
    langsmithUrl: v.optional(v.string()),
    langsmithSyncStatus: v.optional(v.string()),
    metadata: v.any(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_kb", ["kbId"]),

  // ─── Questions (individual questions within a dataset) ───
  questions: defineTable({
    datasetId: v.id("datasets"),
    queryId: v.string(),
    queryText: v.string(),
    sourceDocId: v.string(),
    relevantSpans: v.array(spanValidator),
    metadata: v.any(),
  })
    .index("by_dataset", ["datasetId"])
    .index("by_source_doc", ["datasetId", "sourceDocId"]),

  // ─── Retrievers (pipeline-configured retrievers on a KB) ───
  retrievers: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    name: v.string(),
    retrieverConfig: v.any(),
    indexConfigHash: v.string(),
    retrieverConfigHash: v.string(),
    defaultK: v.number(),
    indexingJobId: v.optional(v.id("indexingJobs")),
    status: v.union(
      v.literal("configuring"),
      v.literal("indexing"),
      v.literal("ready"),
      v.literal("error"),
    ),
    chunkCount: v.optional(v.number()),
    error: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_kb", ["kbId"])
    .index("by_kb_config_hash", ["kbId", "retrieverConfigHash"]),

  // ─── Experiments (evaluation runs against a dataset) ───
  experiments: defineTable({
    orgId: v.string(),
    datasetId: v.id("datasets"),
    name: v.string(),
    retrieverId: v.optional(v.id("retrievers")),
    retrieverConfig: v.optional(v.any()),
    k: v.optional(v.number()),
    metricNames: v.array(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    indexConfigHash: v.optional(v.string()),
    scores: v.optional(v.any()),
    langsmithExperimentId: v.optional(v.string()),
    langsmithUrl: v.optional(v.string()),
    langsmithSyncStatus: v.optional(v.string()),
    error: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_dataset", ["datasetId"])
    .index("by_retriever", ["retrieverId"]),

  // ─── Experiment Results (per-question evaluation results) ───
  experimentResults: defineTable({
    experimentId: v.id("experiments"),
    questionId: v.id("questions"),
    retrievedSpans: v.array(spanValidator),
    scores: v.any(),
    metadata: v.any(),
  }).index("by_experiment", ["experimentId"]),

  // ─── Jobs (long-running task tracking) ───
  jobs: defineTable({
    orgId: v.string(),
    type: v.string(),
    status: v.string(),
    phase: v.optional(v.string()),
    progress: v.optional(
      v.object({
        current: v.number(),
        total: v.number(),
        message: v.optional(v.string()),
      }),
    ),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    retryCount: v.number(),
    maxRetries: v.number(),
    intermediateState: v.optional(v.any()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_org_status", ["orgId", "status"]),

  // ─── Job Items (per-item tracking within a job phase) ───
  jobItems: defineTable({
    jobId: v.id("jobs"),
    phase: v.string(),
    itemKey: v.string(),
    status: v.string(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    processedAt: v.optional(v.number()),
  })
    .index("by_job_phase", ["jobId", "phase"])
    .index("by_job_phase_status", ["jobId", "phase", "status"]),

  // ─── Document Chunks (position-aware, with vector embeddings) ───
  documentChunks: defineTable({
    documentId: v.id("documents"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.optional(v.string()),
    chunkId: v.string(),
    content: v.string(),
    start: v.number(),
    end: v.number(),
    embedding: v.optional(v.array(v.float64())),
    metadata: v.any(),
  })
    .index("by_document", ["documentId"])
    .index("by_kb", ["kbId"])
    .index("by_kb_config", ["kbId", "indexConfigHash"])
    .index("by_doc_config", ["documentId", "indexConfigHash"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["kbId", "indexConfigHash"],
    }),

  // ─── Indexing Jobs (WorkPool-based KB indexing tracking) ───
  indexingJobs: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    indexConfig: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("completed_with_errors"),
      v.literal("failed"),
      v.literal("canceling"),
      v.literal("canceled"),
    ),
    totalDocs: v.number(),
    processedDocs: v.number(),
    failedDocs: v.number(),
    skippedDocs: v.number(),
    totalChunks: v.number(),
    error: v.optional(v.string()),
    failedDocDetails: v.optional(
      v.array(
        v.object({
          documentId: v.id("documents"),
          error: v.string(),
        }),
      ),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_kb_config", ["kbId", "indexConfigHash"])
    .index("by_org", ["orgId"])
    .index("by_status", ["orgId", "status"]),
});
