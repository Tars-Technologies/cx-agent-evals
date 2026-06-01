import { defineTable } from "convex/server";
import { v } from "convex/values";

// Agent-domain tables. Eval system is the re-haul design
// (evaluators + evaluatorLabels + evaluationRuns/Results + error analysis);
// main's older eval tables (evaluatorConfigs/Runs/Results/Sets, agentExperimentResults,
// failureModeQuestionMappings) are intentionally dropped.
export const agentTables = {
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

  annotations: defineTable({
    orgId: v.string(),
    errorAnalysisId: v.id("errorAnalyses"),
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
    .index("by_analysis", ["errorAnalysisId"])
    .index("by_conversation", ["source.conversationId"])
    .index("by_transcript",   ["source.transcriptId"]),

  // ─── Failure Modes (axial codes grouping failure patterns) ───
  failureModes: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    errorAnalysisId: v.id("errorAnalyses"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_agent", ["agentId"])
    .index("by_analysis", ["errorAnalysisId"]),

  // ─── Error Analyses (containers for annotation + axial coding work) ───
  errorAnalyses: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    name: v.string(),
    origin: v.union(
      v.object({ kind: v.literal("simulation"), simulationId: v.id("conversationSimulations") }),
      v.object({ kind: v.literal("upload"),     uploadId:     v.id("livechatUploads") }),
      v.object({ kind: v.literal("playground") }),
      v.object({ kind: v.literal("custom") }),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_origin_simulation", ["agentId", "origin.simulationId"])
    .index("by_agent_origin_upload",     ["agentId", "origin.uploadId"]),

  errorAnalysisMembers: defineTable({
    orgId: v.string(),
    errorAnalysisId: v.id("errorAnalyses"),
    source: v.union(
      v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
      v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
    ),
    addedVia: v.union(v.literal("annotation"), v.literal("import")),
    addedAt: v.number(),
  })
    .index("by_analysis", ["errorAnalysisId"])
    .index("by_analysis_conversation", ["errorAnalysisId", "source.conversationId"])
    .index("by_analysis_transcript",   ["errorAnalysisId", "source.transcriptId"]),

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

  evaluationRuns: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    evaluatorId: v.id("evaluators"),
    cohort: v.object({
      kind: v.literal("simulation"),
      simulationId: v.id("conversationSimulations"),
    }),
    n: v.number(),
    observedPassRate: v.number(),
    correctedPassRate: v.number(),
    ci: v.object({ lower: v.number(), upper: v.number() }),
    corrected: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_evaluator", ["evaluatorId"])
    .index("by_simulation", ["cohort.simulationId"]),

  evaluationResults: defineTable({
    orgId: v.string(),
    evaluationRunId: v.id("evaluationRuns"),
    source: v.union(
      v.object({
        kind: v.literal("conversation"),
        conversationId: v.id("conversations"),
      }),
      v.object({
        kind: v.literal("transcript"),
        transcriptId: v.id("livechatConversations"),
      }),
    ),
    passed: v.boolean(),
    justification: v.string(),
  }).index("by_run", ["evaluationRunId"]),

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
      v.object({
        kind: v.literal("error_analysis"),
        failureModeId: v.id("failureModes"),
        errorAnalysisId: v.id("errorAnalyses"),
      }),
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
    testMetrics: v.optional(
      v.object({
        tpr: v.number(),
        tnr: v.number(),
        agreement: v.number(),
        n: v.number(),
      }),
    ),
    devMetricsCI: v.optional(
      v.object({
        tpr: v.object({ lower: v.number(), upper: v.number() }),
        tnr: v.object({ lower: v.number(), upper: v.number() }),
      }),
    ),
    testMetricsCI: v.optional(
      v.object({
        tpr: v.object({ lower: v.number(), upper: v.number() }),
        tnr: v.object({ lower: v.number(), upper: v.number() }),
      }),
    ),
    labelCounts: v.optional(
      v.object({
        passDev: v.number(),
        failDev: v.number(),
        passTest: v.number(),
        failTest: v.number(),
      }),
    ),
    validatedAt: v.optional(v.number()),
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
};
