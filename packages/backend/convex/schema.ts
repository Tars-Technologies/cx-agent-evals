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
    documentCount: v.optional(v.number()),
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
    priority: v.optional(v.number()),  // 1-5, default 3
    createdAt: v.number(),
  })
    .index("by_kb", ["kbId"])
    .index("by_kb_doc_id", ["kbId", "docId"])
    .index("by_kb_priority", ["kbId", "priority"])
    .index("by_org", ["orgId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["kbId"],
    })
    .searchIndex("search_title", {
      searchField: "title",
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
    realWorldQuestionCount: v.optional(v.number()),
    type: v.optional(v.union(v.literal("questions"), v.literal("conversation_sim"))),
    scenarioCount: v.optional(v.number()),
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
    source: v.optional(v.string()),
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
    totalDocs: v.optional(v.number()),
    docsProcessed: v.optional(v.number()),
    currentDocName: v.optional(v.string()),
    // Shared generation plan data — stored once, read by per-doc actions
    generationPlan: v.optional(v.any()),
    questionsGenerated: v.optional(v.number()),
    missedQuestions: v.optional(v.number()),
    pass2Enriched: v.optional(v.number()),
    pass2Unchanged: v.optional(v.number()),
  })
    .index("by_dataset", ["datasetId"])
    .index("by_org", ["orgId"])
    .index("by_status", ["orgId", "status"]),

  // ── Livechat uploads ──
  livechatUploads: defineTable({
    orgId: v.string(),
    createdBy: v.id("users"),
    filename: v.string(),
    csvStorageId: v.id("_storage"),

    status: v.union(
      v.literal("pending"),
      v.literal("parsing"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("deleting"),
    ),
    error: v.optional(v.string()),

    conversationCount: v.optional(v.number()),
    parsedConversations: v.optional(v.number()),
    basicStats: v.optional(v.any()),

    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    workIds: v.optional(v.array(v.string())),
  })
    .index("by_org", ["orgId"])
    .index("by_org_created", ["orgId", "createdAt"]),

  // ── Livechat conversations (one row per conversation per upload) ──
  livechatConversations: defineTable({
    uploadId: v.id("livechatUploads"),
    orgId: v.string(),

    conversationId: v.string(),
    visitorId: v.string(),
    visitorName: v.string(),
    visitorPhone: v.string(),
    visitorEmail: v.string(),
    agentId: v.string(),
    agentName: v.string(),
    agentEmail: v.string(),
    inbox: v.string(),
    labels: v.array(v.string()),
    status: v.string(),

    messages: v.array(
      v.object({
        id: v.number(),
        role: v.union(
          v.literal("user"),
          v.literal("human_agent"),
          v.literal("workflow_input"),
        ),
        text: v.string(),
      }),
    ),

    metadata: v.any(),

    botFlowInput: v.optional(
      v.object({
        intent: v.string(),
        language: v.string(),
      }),
    ),

    messageTypes: v.optional(v.any()),
    classifiedMessages: v.optional(v.any()),
    blocks: v.optional(v.any()),
    templateId: v.optional(v.string()),
    classificationStatus: v.union(
      v.literal("none"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    classificationError: v.optional(v.string()),

    translatedMessages: v.optional(
      v.array(
        v.object({
          id: v.number(),
          text: v.string(),
        }),
      ),
    ),
    translationStatus: v.union(
      v.literal("none"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    translationError: v.optional(v.string()),
  })
    .index("by_upload", ["uploadId"])
    .index("by_upload_classification", ["uploadId", "classificationStatus"])
    .index("by_org", ["orgId"]),

  // ─── Experiments (evaluation runs against a dataset) ───
  experiments: defineTable({
    orgId: v.string(),
    kbId: v.optional(v.id("knowledgeBases")),
    datasetId: v.id("datasets"),
    name: v.string(),
    retrieverId: v.optional(v.id("retrievers")),
    retrieverConfig: v.optional(v.any()),
    experimentRunId: v.optional(v.id("experimentRuns")),
    experimentType: v.optional(v.literal("retriever")),
    agentId: v.optional(v.id("agents")),
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
    .index("by_kb", ["kbId"])
    .index("by_agent", ["agentId"])
    .index("by_run", ["experimentRunId"]),

  // ─── Experiment Runs (groups of retriever experiments) ───
  experimentRuns: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    datasetId: v.id("datasets"),
    name: v.string(),
    retrieverIds: v.array(v.id("retrievers")),
    metricNames: v.array(v.string()),
    scoringWeights: v.object({
      recall: v.number(),
      precision: v.number(),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("completed_with_errors"),
      v.literal("failed"),
      v.literal("canceling"),
      v.literal("canceled"),
    ),
    totalRetrievers: v.number(),
    completedRetrievers: v.number(),
    failedRetrievers: v.number(),
    winnerId: v.optional(v.id("retrievers")),
    winnerName: v.optional(v.string()),
    winnerScore: v.optional(v.number()),
    error: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_kb", ["kbId"])
    .index("by_dataset", ["datasetId"]),

  // ─── Experiment Results (per-question evaluation results) ───
  experimentResults: defineTable({
    experimentId: v.id("experiments"),
    questionId: v.id("questions"),
    retrievedSpans: v.array(spanValidator),
    scores: v.record(v.string(), v.number()),
    metadata: v.any(),
  }).index("by_experiment", ["experimentId"]),

  // ─── Annotations (human ratings on conversations / transcripts) ───
  annotations: defineTable({
    orgId: v.string(),
    source: v.union(
      v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
      v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
    ),
    rating: v.union(
      v.literal("great"), v.literal("good_enough"),
      v.literal("bad"),   v.literal("pass"), v.literal("fail"),
    ),
    comment: v.optional(v.string()),
    tags: v.array(v.string()),
    ratedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_conversation", ["source.conversationId"])
    .index("by_transcript",   ["source.transcriptId"]),

  // ─── Failure Modes (axial codes grouping failure patterns) ───
  failureModes: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_agent", ["agentId"]),

  // ─── Failure Mode Memberships (many-to-many) ───
  failureModeMemberships: defineTable({
    orgId: v.string(),
    failureModeId: v.id("failureModes"),
    source: v.union(
      v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
      v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
    ),
    createdAt: v.number(),
  })
    .index("by_failure_mode", ["failureModeId"])
    .index("by_conversation", ["source.conversationId"])
    .index("by_transcript",   ["source.transcriptId"]),

  // ─── Evaluator Templates (catalog of pre-built evaluator configs) ───
  evaluatorTemplates: defineTable({
    name: v.string(),
    description: v.string(),
    category: v.string(),
    type: v.union(v.literal("code"), v.literal("llm_judge")),
    prefilledConfig: v.any(),
  })
    .index("by_category", ["category"]),

  // ─── Evaluator Labels (human pass/fail labels for calibration) ───
  evaluatorLabels: defineTable({
    orgId: v.string(),
    evaluatorId: v.id("evaluators"),
    failureModeId: v.optional(v.id("failureModes")),
    source: v.union(
      v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
      v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
    ),
    humanLabel: v.union(v.literal("pass"), v.literal("fail")),
    splitAssignment: v.optional(v.union(
      v.literal("train"), v.literal("dev"), v.literal("test"),
    )),
    origin: v.union(
      v.object({ kind: v.literal("axial_coding"),        failureModeId: v.id("failureModes") }),
      v.object({ kind: v.literal("inferred_negative") }),
      v.object({ kind: v.literal("calibration_pass") }),
      v.object({ kind: v.literal("imported_annotation"), annotationId:  v.id("annotations") }),
    ),
    ratedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_evaluator", ["evaluatorId"])
    .index("by_evaluator_split", ["evaluatorId", "splitAssignment"]),

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

  // ── Agents ──────────────────────────────────────────────
  agents: defineTable({
    orgId: v.string(),
    name: v.string(),

    // Structured prompt sections
    identity: v.object({
      agentName: v.string(),
      companyName: v.string(),
      companyUrl: v.optional(v.string()),
      companyContext: v.optional(v.string()),
      roleDescription: v.string(),
      brandVoice: v.optional(v.string()),
    }),
    guardrails: v.object({
      outOfScope: v.optional(v.string()),
      escalationRules: v.optional(v.string()),
      compliance: v.optional(v.string()),
    }),
    responseStyle: v.object({
      formatting: v.optional(v.string()),
      length: v.optional(v.string()),
      formality: v.optional(v.string()),
      language: v.optional(v.string()),
    }),
    additionalInstructions: v.optional(v.string()),

    model: v.string(),
    enableReflection: v.boolean(),
    retrieverIds: v.array(v.id("retrievers")),

    status: v.union(
      v.literal("draft"),
      v.literal("ready"),
      v.literal("error"),
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"]),

  conversations: defineTable({
    orgId: v.string(),
    title: v.optional(v.string()),
    agentIds: v.array(v.id("agents")),
    status: v.union(v.literal("active"), v.literal("archived")),
    source: v.optional(v.union(
      v.literal("playground"), v.literal("simulation"),
    )),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    order: v.number(),
    role: v.union(
      v.literal("system"),
      v.literal("user"),
      v.literal("assistant"),
      v.literal("tool_call"),
      v.literal("tool_result"),
    ),
    content: v.string(),
    agentId: v.optional(v.id("agents")),
    toolCall: v.optional(
      v.object({
        toolCallId: v.string(),
        toolName: v.string(),
        toolArgs: v.string(),
        retrieverId: v.optional(v.id("retrievers")),
      }),
    ),
    toolResult: v.optional(
      v.object({
        toolCallId: v.string(),
        toolName: v.string(),
        result: v.string(),
        retrieverId: v.optional(v.id("retrievers")),
      }),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("streaming"),
      v.literal("complete"),
      v.literal("error"),
    ),
    usage: v.optional(
      v.object({
        promptTokens: v.number(),
        completionTokens: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId", "order"]),

  streamDeltas: defineTable({
    messageId: v.id("messages"),
    start: v.number(),
    end: v.number(),
    text: v.string(),
  })
    .index("by_message", ["messageId", "start"]),

  // === Conversation Simulation ===

  conversationScenarios: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    scenarioSetId: v.id("scenarioSets"),
    source: v.union(
      v.object({ kind: v.literal("synthetic"),  kbId: v.id("knowledgeBases") }),
      v.object({ kind: v.literal("grounded"),   transcriptUploadId: v.id("livechatUploads") }),
    ),
    persona: v.object({
      type: v.string(),
      traits: v.array(v.string()),
      communicationStyle: v.string(),
      patienceLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    }),
    topic: v.string(),
    intent: v.string(),
    complexity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    reasonForContact: v.string(),
    knownInfo: v.string(),
    unknownInfo: v.string(),
    instruction: v.string(),
    referenceMessages: v.optional(v.array(v.object({
      role: v.literal("user"),
      content: v.string(),
      turnIndex: v.number(),
    }))),
    languages: v.optional(v.array(v.string())),
    referenceTranscript: v.optional(v.array(v.object({
      id: v.number(),
      role: v.union(v.literal("user"), v.literal("human_agent"), v.literal("workflow_input")),
      text: v.string(),
    }))),
    referenceExemplars: v.optional(v.array(v.object({
      sourceTranscriptId: v.id("livechatConversations"),
      messages: v.array(v.object({
        id: v.number(),
        role: v.union(v.literal("user"), v.literal("human_agent"), v.literal("workflow_input")),
        text: v.string(),
      })),
    }))),
    userMessageLengthStats: v.optional(v.object({
      median: v.number(),
      p90: v.number(),
    })),
    behaviorAnchors: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_set", ["scenarioSetId"])
    .index("by_kb", ["source.kbId"])
    .index("by_transcript_upload", ["source.transcriptUploadId"]),

  evaluators: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    name: v.string(),
    description: v.string(),
    type: v.union(v.literal("code"), v.literal("llm_judge")),
    codeJudgeConfig: v.optional(v.object({
      checkType: v.union(
        v.literal("tool_call_match"),
        v.literal("string_contains"),
        v.literal("regex_match"),
        v.literal("response_format"),
      ),
      params: v.any(),
    })),
    llmJudgeConfig: v.optional(v.object({
      dimensions: v.array(v.object({
        failureModeId: v.optional(v.id("failureModes")),
        name: v.string(),
        rubric: v.string(),
        passExamples: v.array(v.string()),
        failExamples: v.array(v.string()),
      })),
      outputFormat: v.union(v.literal("per_dimension"), v.literal("aggregate")),
      model: v.string(),
      inputContext: v.array(v.union(
        v.literal("transcript"),
        v.literal("tool_calls"),
        v.literal("kb_documents"),
      )),
    })),
    source: v.union(
      v.object({ kind: v.literal("manual") }),
      v.object({ kind: v.literal("template"),       templateId:    v.id("evaluatorTemplates") }),
      v.object({ kind: v.literal("error_analysis"), failureModeId: v.id("failureModes") }),
    ),
    status: v.union(
      v.literal("draft"), v.literal("calibrating"),
      v.literal("validated"), v.literal("ready"),
    ),
    splitConfig: v.optional(v.object({
      trainPct: v.number(),
      devPct: v.number(),
      testPct: v.number(),
    })),
    splitSeed: v.optional(v.number()),
    devMetrics: v.optional(v.object({
      tpr: v.number(),
      tnr: v.number(),
      agreement: v.number(),
    })),
    tags: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_status", ["agentId", "status"]),

  conversationSimulations: defineTable({
    orgId: v.string(),
    userId: v.id("users"),
    agentId: v.id("agents"),
    scenarioSetId: v.id("scenarioSets"),
    k: v.number(),
    passThreshold: v.optional(v.number()),
    concurrency: v.number(),
    maxTurns: v.number(),
    timeoutMs: v.number(),
    userSimModel: v.string(),
    seed: v.optional(v.number()),
    status: v.union(
      v.literal("pending"), v.literal("running"), v.literal("completed"),
      v.literal("failed"), v.literal("cancelled"),
    ),
    totalRuns: v.number(),
    completedRuns: v.number(),
    failedRuns: v.optional(v.number()),
    overallPassRate: v.optional(v.number()),
    avgScore: v.optional(v.number()),
    workIds: v.optional(v.array(v.string())),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_agent", ["agentId"])
    .index("by_set", ["scenarioSetId"]),

  conversationSimRuns: defineTable({
    simulationId: v.id("conversationSimulations"),
    scenarioId: v.id("conversationScenarios"),
    agentId: v.id("agents"),
    kIndex: v.number(),
    seed: v.number(),
    conversationId: v.optional(v.id("conversations")),
    status: v.union(
      v.literal("pending"), v.literal("running"),
      v.literal("completed"), v.literal("failed"),
    ),
    terminationReason: v.optional(v.union(
      v.literal("user_stop"), v.literal("agent_stop"),
      v.literal("max_turns"), v.literal("timeout"), v.literal("error"),
    )),
    turnCount: v.optional(v.number()),
    evaluatorResults: v.optional(v.array(v.object({
      evaluatorId: v.id("evaluators"),
      evaluatorName: v.string(),
      passed: v.boolean(),
      justification: v.string(),
      required: v.boolean(),
    }))),
    score: v.optional(v.number()),
    passed: v.optional(v.boolean()),
    toolCallCount: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  })
    .index("by_simulation", ["simulationId"])
    .index("by_scenario", ["scenarioId"])
    .index("by_simulation_scenario", ["simulationId", "scenarioId"]),

  scenarioGenJobs: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    scenarioSetId: v.id("scenarioSets"),
    // Inputs available for generation. A single job can run both synthetic
    // (kbId) and grounded (transcriptUploadId) tracks; the per-scenario row
    // still carries its own source discriminator.
    kbId: v.optional(v.id("knowledgeBases")),
    transcriptUploadId: v.optional(v.id("livechatUploads")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    targetCount: v.number(),
    generatedCount: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    transcriptUploadIds: v.optional(v.array(v.id("livechatUploads"))),
    transcriptConversationIds: v.optional(v.array(v.id("livechatConversations"))),
    distribution: v.optional(v.number()),  // 0-100, % transcript-grounded
    fidelity: v.optional(v.number()),      // 0-100, high = faithful
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_agent", ["agentId"]),

  scenarioSets: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    name: v.string(),
    source: v.union(
      v.literal("synthetic"),
      v.literal("grounded"),
      v.literal("mixed"),
    ),
    generationConfig: v.object({
      kbId: v.optional(v.id("knowledgeBases")),
      transcriptUploadId: v.optional(v.id("livechatUploads")),
      transcriptConversationIds: v.optional(
        v.array(v.id("livechatConversations")),
      ),
      targetCount: v.number(),
      distribution: v.optional(v.number()),
      fidelity: v.optional(v.number()),
      complexityDistribution: v.optional(
        v.object({ low: v.number(), medium: v.number(), high: v.number() }),
      ),
      model: v.optional(v.string()),
    }),
    scenarioCount: v.number(),
    generationJobId: v.optional(v.id("scenarioGenJobs")),
    createdAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_org", ["orgId"]),
});
