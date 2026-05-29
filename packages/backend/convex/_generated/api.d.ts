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
import type * as annotations_migrations from "../annotations/migrations.js";
import type * as conversationSim_actions from "../conversationSim/actions.js";
import type * as conversationSim_anchorPrompt from "../conversationSim/anchorPrompt.js";
import type * as conversationSim_evaluation from "../conversationSim/evaluation.js";
import type * as conversationSim_evaluationActions from "../conversationSim/evaluationActions.js";
import type * as conversationSim_evaluatorSets from "../conversationSim/evaluatorSets.js";
import type * as conversationSim_evaluators from "../conversationSim/evaluators.js";
import type * as conversationSim_extractJson from "../conversationSim/extractJson.js";
import type * as conversationSim_generation from "../conversationSim/generation.js";
import type * as conversationSim_generationActions from "../conversationSim/generationActions.js";
import type * as conversationSim_judge from "../conversationSim/judge.js";
import type * as conversationSim_lengthStats from "../conversationSim/lengthStats.js";
import type * as conversationSim_migrations from "../conversationSim/migrations.js";
import type * as conversationSim_migrationsActions from "../conversationSim/migrationsActions.js";
import type * as conversationSim_orchestration from "../conversationSim/orchestration.js";
import type * as conversationSim_prompt from "../conversationSim/prompt.js";
import type * as conversationSim_runs from "../conversationSim/runs.js";
import type * as conversationSim_sampleCorpusExemplars from "../conversationSim/sampleCorpusExemplars.js";
import type * as conversationSim_scenarios from "../conversationSim/scenarios.js";
import type * as crons from "../crons.js";
import type * as crud_agents from "../crud/agents.js";
import type * as crud_conversations from "../crud/conversations.js";
import type * as crud_users from "../crud/users.js";
import type * as evaluator_actions from "../evaluator/actions.js";
import type * as evaluator_crud from "../evaluator/crud.js";
import type * as evaluator_metrics from "../evaluator/metrics.js";
import type * as evaluator_parseJudge from "../evaluator/parseJudge.js";
import type * as evaluator_splits from "../evaluator/splits.js";
import type * as experimentRuns_orchestration from "../experimentRuns/orchestration.js";
import type * as experiments_agentActions from "../experiments/agentActions.js";
import type * as experiments_agentResults from "../experiments/agentResults.js";
import type * as experiments_orchestration from "../experiments/orchestration.js";
import type * as failureModes_actions from "../failureModes/actions.js";
import type * as failureModes_crud from "../failureModes/crud.js";
import type * as kb_chunks from "../kb/chunks.js";
import type * as kb_core from "../kb/core.js";
import type * as kb_coreActions from "../kb/coreActions.js";
import type * as kb_datasets from "../kb/datasets.js";
import type * as kb_documents from "../kb/documents.js";
import type * as kb_experimentActions from "../kb/experimentActions.js";
import type * as kb_experiments from "../kb/experiments.js";
import type * as kb_generation from "../kb/generation.js";
import type * as kb_generationActions from "../kb/generationActions.js";
import type * as kb_indexing from "../kb/indexing.js";
import type * as kb_indexingActions from "../kb/indexingActions.js";
import type * as kb_langsmithActions from "../kb/langsmithActions.js";
import type * as kb_langsmithRetry from "../kb/langsmithRetry.js";
import type * as kb_pipelineActions from "../kb/pipelineActions.js";
import type * as kb_questions from "../kb/questions.js";
import type * as kb_results from "../kb/results.js";
import type * as kb_retrieveActions from "../kb/retrieveActions.js";
import type * as kb_retrievers from "../kb/retrievers.js";
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
  "annotations/migrations": typeof annotations_migrations;
  "conversationSim/actions": typeof conversationSim_actions;
  "conversationSim/anchorPrompt": typeof conversationSim_anchorPrompt;
  "conversationSim/evaluation": typeof conversationSim_evaluation;
  "conversationSim/evaluationActions": typeof conversationSim_evaluationActions;
  "conversationSim/evaluatorSets": typeof conversationSim_evaluatorSets;
  "conversationSim/evaluators": typeof conversationSim_evaluators;
  "conversationSim/extractJson": typeof conversationSim_extractJson;
  "conversationSim/generation": typeof conversationSim_generation;
  "conversationSim/generationActions": typeof conversationSim_generationActions;
  "conversationSim/judge": typeof conversationSim_judge;
  "conversationSim/lengthStats": typeof conversationSim_lengthStats;
  "conversationSim/migrations": typeof conversationSim_migrations;
  "conversationSim/migrationsActions": typeof conversationSim_migrationsActions;
  "conversationSim/orchestration": typeof conversationSim_orchestration;
  "conversationSim/prompt": typeof conversationSim_prompt;
  "conversationSim/runs": typeof conversationSim_runs;
  "conversationSim/sampleCorpusExemplars": typeof conversationSim_sampleCorpusExemplars;
  "conversationSim/scenarios": typeof conversationSim_scenarios;
  crons: typeof crons;
  "crud/agents": typeof crud_agents;
  "crud/conversations": typeof crud_conversations;
  "crud/users": typeof crud_users;
  "evaluator/actions": typeof evaluator_actions;
  "evaluator/crud": typeof evaluator_crud;
  "evaluator/metrics": typeof evaluator_metrics;
  "evaluator/parseJudge": typeof evaluator_parseJudge;
  "evaluator/splits": typeof evaluator_splits;
  "experimentRuns/orchestration": typeof experimentRuns_orchestration;
  "experiments/agentActions": typeof experiments_agentActions;
  "experiments/agentResults": typeof experiments_agentResults;
  "experiments/orchestration": typeof experiments_orchestration;
  "failureModes/actions": typeof failureModes_actions;
  "failureModes/crud": typeof failureModes_crud;
  "kb/chunks": typeof kb_chunks;
  "kb/core": typeof kb_core;
  "kb/coreActions": typeof kb_coreActions;
  "kb/datasets": typeof kb_datasets;
  "kb/documents": typeof kb_documents;
  "kb/experimentActions": typeof kb_experimentActions;
  "kb/experiments": typeof kb_experiments;
  "kb/generation": typeof kb_generation;
  "kb/generationActions": typeof kb_generationActions;
  "kb/indexing": typeof kb_indexing;
  "kb/indexingActions": typeof kb_indexingActions;
  "kb/langsmithActions": typeof kb_langsmithActions;
  "kb/langsmithRetry": typeof kb_langsmithRetry;
  "kb/pipelineActions": typeof kb_pipelineActions;
  "kb/questions": typeof kb_questions;
  "kb/results": typeof kb_results;
  "kb/retrieveActions": typeof kb_retrieveActions;
  "kb/retrievers": typeof kb_retrievers;
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
  agentExperimentPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"agentExperimentPool">;
  livechatAnalysisPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"livechatAnalysisPool">;
  conversationSimPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"conversationSimPool">;
};
