import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { spanValidator } from "./lib/validators";

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
    industry: v.optional(v.string()),
    subIndustry: v.optional(v.string()),
    company: v.optional(v.string()),
    entityType: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_industry", ["orgId", "industry"])
    .index("by_org_company", ["orgId", "company"]),

  // ─── Documents (markdown files in a knowledge base) ───
  documents: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    docId: v.string(),
    title: v.string(),
    content: v.string(),
    fileId: v.optional(v.id("_storage")),
    contentLength: v.number(),
    metadata: v.any(),
    sourceUrl: v.optional(v.string()),
    sourceType: v.optional(v.string()),
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
    .index("by_kb", ["kbId"])
    .index("by_sync_status", ["langsmithSyncStatus"]),

  // ─── Questions (individual questions within a dataset) ───
  questions: defineTable({
    datasetId: v.id("datasets"),
    queryId: v.string(),
    queryText: v.string(),
    sourceDocId: v.string(),
    relevantSpans: v.array(spanValidator),
    langsmithExampleId: v.optional(v.string()),
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

  // ─── Generation Jobs (WorkPool-based question generation tracking) ───
  generationJobs: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    datasetId: v.id("datasets"),
    strategy: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("completed_with_errors"),
      v.literal("failed"),
      v.literal("canceling"),
      v.literal("canceled"),
    ),
    phase: v.string(),
    totalItems: v.number(),
    processedItems: v.number(),
    failedItems: v.number(),
    skippedItems: v.number(),
    error: v.optional(v.string()),
    failedItemDetails: v.optional(
      v.array(
        v.object({
          itemKey: v.string(),
          error: v.string(),
        }),
      ),
    ),
    workIds: v.optional(v.array(v.string())),
    phase1Stats: v.optional(
      v.object({
        processedItems: v.number(),
        failedItems: v.number(),
        skippedItems: v.number(),
      }),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_dataset", ["datasetId"])
    .index("by_org", ["orgId"])
    .index("by_status", ["orgId", "status"]),

  // ─── Experiments (evaluation runs against a dataset) ───
  experiments: defineTable({
    orgId: v.string(),
    kbId: v.optional(v.id("knowledgeBases")),
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
      v.literal("completed_with_errors"),
      v.literal("failed"),
      v.literal("canceling"),
      v.literal("canceled"),
    ),
    phase: v.optional(
      v.union(
        v.literal("initializing"),
        v.literal("indexing"),
        v.literal("syncing"),
        v.literal("evaluating"),
        v.literal("done"),
      ),
    ),
    totalQuestions: v.optional(v.number()),
    processedQuestions: v.optional(v.number()),
    failedQuestions: v.optional(v.number()),
    skippedQuestions: v.optional(v.number()),
    indexConfigHash: v.optional(v.string()),
    langsmithSyncStatus: v.optional(v.string()),
    workIds: v.optional(v.array(v.string())),
    scores: v.optional(v.record(v.string(), v.number())),
    // TODO: populate langsmithExperimentId from evaluate() result
    langsmithExperimentId: v.optional(v.string()),
    // TODO: populate langsmithUrl from evaluate() result (used in frontend for experiment links)
    langsmithUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_dataset", ["datasetId"])
    .index("by_retriever", ["retrieverId"])
    .index("by_kb", ["kbId"]),

  // ─── Experiment Results (per-question evaluation results) ───
  experimentResults: defineTable({
    experimentId: v.id("experiments"),
    questionId: v.id("questions"),
    retrievedSpans: v.array(spanValidator),
    scores: v.record(v.string(), v.number()),
    metadata: v.any(),
  }).index("by_experiment", ["experimentId"]),

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
    workIds: v.optional(v.array(v.string())),
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

  // ─── Crawl Jobs (web scraping job tracking) ───
  crawlJobs: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    userId: v.id("users"),
    startUrl: v.string(),
    config: v.object({
      maxDepth: v.optional(v.number()),
      maxPages: v.optional(v.number()),
      includePaths: v.optional(v.array(v.string())),
      excludePaths: v.optional(v.array(v.string())),
      allowSubdomains: v.optional(v.boolean()),
      onlyMainContent: v.optional(v.boolean()),
      delay: v.optional(v.number()),
      concurrency: v.optional(v.number()),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("completed_with_errors"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    stats: v.object({
      discovered: v.number(),
      scraped: v.number(),
      failed: v.number(),
      skipped: v.number(),
    }),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_kb", ["kbId"])
    .index("by_status", ["orgId", "status"]),

  // ─── Crawl URLs (URL frontier for crawl jobs) ───
  crawlUrls: defineTable({
    crawlJobId: v.id("crawlJobs"),
    url: v.string(),
    normalizedUrl: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("scraping"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    depth: v.number(),
    parentUrl: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    error: v.optional(v.string()),
    retryCount: v.optional(v.number()),
    scrapedAt: v.optional(v.number()),
  })
    .index("by_job_status", ["crawlJobId", "status"])
    .index("by_job_url", ["crawlJobId", "normalizedUrl"]),
});
