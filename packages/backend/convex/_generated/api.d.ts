/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_actions from "../agents/actions.js";
import type * as agents_orchestration from "../agents/orchestration.js";
import type * as agents_promptTemplate from "../agents/promptTemplate.js";
import type * as annotations_crud from "../annotations/crud.js";
import type * as config from "../config.js";
import type * as conversationSim_actions from "../conversationSim/actions.js";
import type * as conversationSim_anchorPrompt from "../conversationSim/anchorPrompt.js";
import type * as conversationSim_extractJson from "../conversationSim/extractJson.js";
import type * as conversationSim_generation from "../conversationSim/generation.js";
import type * as conversationSim_generationActions from "../conversationSim/generationActions.js";
import type * as conversationSim_lengthStats from "../conversationSim/lengthStats.js";
import type * as conversationSim_orchestration from "../conversationSim/orchestration.js";
import type * as conversationSim_prompt from "../conversationSim/prompt.js";
import type * as conversationSim_runs from "../conversationSim/runs.js";
import type * as conversationSim_sampleCorpusExemplars from "../conversationSim/sampleCorpusExemplars.js";
import type * as conversationSim_scenarioSets from "../conversationSim/scenarioSets.js";
import type * as conversationSim_scenarios from "../conversationSim/scenarios.js";
import type * as conversationSim_wipe from "../conversationSim/wipe.js";
import type * as crons from "../crons.js";
import type * as crud_agents from "../crud/agents.js";
import type * as crud_conversations from "../crud/conversations.js";
import type * as crud_datasets from "../crud/datasets.js";
import type * as crud_documents from "../crud/documents.js";
import type * as crud_knowledgeBases from "../crud/knowledgeBases.js";
import type * as crud_knowledgeBasesActions from "../crud/knowledgeBasesActions.js";
import type * as crud_questions from "../crud/questions.js";
import type * as crud_retrievers from "../crud/retrievers.js";
import type * as crud_users from "../crud/users.js";
import type * as env from "../env.js";
import type * as errorAnalysis_clustering from "../errorAnalysis/clustering.js";
import type * as errorAnalysis_clusteringHelpers from "../errorAnalysis/clusteringHelpers.js";
import type * as errorAnalysis_members from "../errorAnalysis/members.js";
import type * as errorAnalysis_orchestration from "../errorAnalysis/orchestration.js";
import type * as evaluator_autoApply from "../evaluator/autoApply.js";
import type * as evaluator_batchApply from "../evaluator/batchApply.js";
import type * as evaluator_crud from "../evaluator/crud.js";
import type * as evaluator_evaluationRuns from "../evaluator/evaluationRuns.js";
import type * as evaluator_fewShot from "../evaluator/fewShot.js";
import type * as evaluator_fewShotForEvaluator from "../evaluator/fewShotForEvaluator.js";
import type * as evaluator_labels from "../evaluator/labels.js";
import type * as evaluator_llmJudge from "../evaluator/llmJudge.js";
import type * as evaluator_metrics from "../evaluator/metrics.js";
import type * as evaluator_parseJudge from "../evaluator/parseJudge.js";
import type * as evaluator_scoreOne from "../evaluator/scoreOne.js";
import type * as evaluator_sources from "../evaluator/sources.js";
import type * as evaluator_spawnJudge from "../evaluator/spawnJudge.js";
import type * as evaluator_splits from "../evaluator/splits.js";
import type * as evaluator_templates from "../evaluator/templates.js";
import type * as evaluator_validate from "../evaluator/validate.js";
import type * as experimentRuns_orchestration from "../experimentRuns/orchestration.js";
import type * as experiments_actions from "../experiments/actions.js";
import type * as experiments_orchestration from "../experiments/orchestration.js";
import type * as experiments_results from "../experiments/results.js";
import type * as failureModes_crud from "../failureModes/crud.js";
import type * as failureModes_memberships from "../failureModes/memberships.js";
import type * as generation_actions from "../generation/actions.js";
import type * as generation_orchestration from "../generation/orchestration.js";
import type * as langsmith_retry from "../langsmith/retry.js";
import type * as langsmith_sync from "../langsmith/sync.js";
import type * as langsmith_syncRetry from "../langsmith/syncRetry.js";
import type * as lib_agentLoop from "../lib/agentLoop.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_auth_tenant from "../lib/auth/tenant.js";
import type * as lib_docId from "../lib/docId.js";
import type * as lib_labels from "../lib/labels.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_vectorSearch from "../lib/vectorSearch.js";
import type * as lib_workpool from "../lib/workpool.js";
import type * as livechat_actions from "../livechat/actions.js";
import type * as livechat_orchestration from "../livechat/orchestration.js";
import type * as retrieval_chunks from "../retrieval/chunks.js";
import type * as retrieval_indexing from "../retrieval/indexing.js";
import type * as retrieval_indexingActions from "../retrieval/indexingActions.js";
import type * as retrieval_pipelineActions from "../retrieval/pipelineActions.js";
import type * as retrieval_retrieverActions from "../retrieval/retrieverActions.js";
import type * as scraping_actions from "../scraping/actions.js";
import type * as scraping_orchestration from "../scraping/orchestration.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/actions": typeof agents_actions;
  "agents/orchestration": typeof agents_orchestration;
  "agents/promptTemplate": typeof agents_promptTemplate;
  "annotations/crud": typeof annotations_crud;
  config: typeof config;
  "conversationSim/actions": typeof conversationSim_actions;
  "conversationSim/anchorPrompt": typeof conversationSim_anchorPrompt;
  "conversationSim/extractJson": typeof conversationSim_extractJson;
  "conversationSim/generation": typeof conversationSim_generation;
  "conversationSim/generationActions": typeof conversationSim_generationActions;
  "conversationSim/lengthStats": typeof conversationSim_lengthStats;
  "conversationSim/orchestration": typeof conversationSim_orchestration;
  "conversationSim/prompt": typeof conversationSim_prompt;
  "conversationSim/runs": typeof conversationSim_runs;
  "conversationSim/sampleCorpusExemplars": typeof conversationSim_sampleCorpusExemplars;
  "conversationSim/scenarioSets": typeof conversationSim_scenarioSets;
  "conversationSim/scenarios": typeof conversationSim_scenarios;
  "conversationSim/wipe": typeof conversationSim_wipe;
  crons: typeof crons;
  "crud/agents": typeof crud_agents;
  "crud/conversations": typeof crud_conversations;
  "crud/datasets": typeof crud_datasets;
  "crud/documents": typeof crud_documents;
  "crud/knowledgeBases": typeof crud_knowledgeBases;
  "crud/knowledgeBasesActions": typeof crud_knowledgeBasesActions;
  "crud/questions": typeof crud_questions;
  "crud/retrievers": typeof crud_retrievers;
  "crud/users": typeof crud_users;
  env: typeof env;
  "errorAnalysis/clustering": typeof errorAnalysis_clustering;
  "errorAnalysis/clusteringHelpers": typeof errorAnalysis_clusteringHelpers;
  "errorAnalysis/members": typeof errorAnalysis_members;
  "errorAnalysis/orchestration": typeof errorAnalysis_orchestration;
  "evaluator/autoApply": typeof evaluator_autoApply;
  "evaluator/batchApply": typeof evaluator_batchApply;
  "evaluator/crud": typeof evaluator_crud;
  "evaluator/evaluationRuns": typeof evaluator_evaluationRuns;
  "evaluator/fewShot": typeof evaluator_fewShot;
  "evaluator/fewShotForEvaluator": typeof evaluator_fewShotForEvaluator;
  "evaluator/labels": typeof evaluator_labels;
  "evaluator/llmJudge": typeof evaluator_llmJudge;
  "evaluator/metrics": typeof evaluator_metrics;
  "evaluator/parseJudge": typeof evaluator_parseJudge;
  "evaluator/scoreOne": typeof evaluator_scoreOne;
  "evaluator/sources": typeof evaluator_sources;
  "evaluator/spawnJudge": typeof evaluator_spawnJudge;
  "evaluator/splits": typeof evaluator_splits;
  "evaluator/templates": typeof evaluator_templates;
  "evaluator/validate": typeof evaluator_validate;
  "experimentRuns/orchestration": typeof experimentRuns_orchestration;
  "experiments/actions": typeof experiments_actions;
  "experiments/orchestration": typeof experiments_orchestration;
  "experiments/results": typeof experiments_results;
  "failureModes/crud": typeof failureModes_crud;
  "failureModes/memberships": typeof failureModes_memberships;
  "generation/actions": typeof generation_actions;
  "generation/orchestration": typeof generation_orchestration;
  "langsmith/retry": typeof langsmith_retry;
  "langsmith/sync": typeof langsmith_sync;
  "langsmith/syncRetry": typeof langsmith_syncRetry;
  "lib/agentLoop": typeof lib_agentLoop;
  "lib/auth": typeof lib_auth;
  "lib/auth/tenant": typeof lib_auth_tenant;
  "lib/docId": typeof lib_docId;
  "lib/labels": typeof lib_labels;
  "lib/validators": typeof lib_validators;
  "lib/vectorSearch": typeof lib_vectorSearch;
  "lib/workpool": typeof lib_workpool;
  "livechat/actions": typeof livechat_actions;
  "livechat/orchestration": typeof livechat_orchestration;
  "retrieval/chunks": typeof retrieval_chunks;
  "retrieval/indexing": typeof retrieval_indexing;
  "retrieval/indexingActions": typeof retrieval_indexingActions;
  "retrieval/pipelineActions": typeof retrieval_pipelineActions;
  "retrieval/retrieverActions": typeof retrieval_retrieverActions;
  "scraping/actions": typeof scraping_actions;
  "scraping/orchestration": typeof scraping_orchestration;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  indexingPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"indexingPool">;
  generationPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"generationPool">;
  experimentPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"experimentPool">;
  scrapingPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"scrapingPool">;
  livechatAnalysisPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"livechatAnalysisPool">;
  conversationSimPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"conversationSimPool">;
};
