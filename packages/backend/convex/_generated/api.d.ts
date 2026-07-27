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
import type * as config from "../config.js";
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
import type * as env from "../env.js";
import type * as evaluator_actions from "../evaluator/actions.js";
import type * as evaluator_crud from "../evaluator/crud.js";
import type * as evaluator_metrics from "../evaluator/metrics.js";
import type * as evaluator_parseJudge from "../evaluator/parseJudge.js";
import type * as evaluator_splits from "../evaluator/splits.js";
import type * as experiments_agentActions from "../experiments/agentActions.js";
import type * as experiments_agentResults from "../experiments/agentResults.js";
import type * as experiments_orchestration from "../experiments/orchestration.js";
import type * as failureModes_actions from "../failureModes/actions.js";
import type * as failureModes_crud from "../failureModes/crud.js";
import type * as http from "../http.js";
import type * as kb_chunks from "../kb/chunks.js";
import type * as kb_core from "../kb/core.js";
import type * as kb_core_actions from "../kb/core_actions.js";
import type * as kb_crawl from "../kb/crawl.js";
import type * as kb_crawl_actions from "../kb/crawl_actions.js";
import type * as kb_datasets from "../kb/datasets.js";
import type * as kb_dimension_guard from "../kb/dimension_guard.js";
import type * as kb_documents from "../kb/documents.js";
import type * as kb_documents_actions from "../kb/documents_actions.js";
import type * as kb_experimentRuns from "../kb/experimentRuns.js";
import type * as kb_experiment_actions from "../kb/experiment_actions.js";
import type * as kb_experiments from "../kb/experiments.js";
import type * as kb_generation from "../kb/generation.js";
import type * as kb_generation_actions from "../kb/generation_actions.js";
import type * as kb_images from "../kb/images.js";
import type * as kb_images_actions from "../kb/images_actions.js";
import type * as kb_indexing from "../kb/indexing.js";
import type * as kb_indexing_actions from "../kb/indexing_actions.js";
import type * as kb_langsmithRetry from "../kb/langsmithRetry.js";
import type * as kb_langsmith_actions from "../kb/langsmith_actions.js";
import type * as kb_langsmith_sync_retry from "../kb/langsmith_sync_retry.js";
import type * as kb_media_runtime from "../kb/media_runtime.js";
import type * as kb_pipeline_actions from "../kb/pipeline_actions.js";
import type * as kb_providers from "../kb/providers.js";
import type * as kb_questions from "../kb/questions.js";
import type * as kb_reranker_selection from "../kb/reranker_selection.js";
import type * as kb_results from "../kb/results.js";
import type * as kb_retrieval_runtime from "../kb/retrieval_runtime.js";
import type * as kb_retrieve_actions from "../kb/retrieve_actions.js";
import type * as kb_retrievers from "../kb/retrievers.js";
import type * as kb_tarser_callback from "../kb/tarser_callback.js";
import type * as kb_tarser_nonce from "../kb/tarser_nonce.js";
import type * as kb_vector_backend from "../kb/vector_backend.js";
import type * as lib_agentLoop from "../lib/agentLoop.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_auth_tenant from "../lib/auth/tenant.js";
import type * as lib_contentCap from "../lib/contentCap.js";
import type * as lib_docId from "../lib/docId.js";
import type * as lib_experimentConcurrency from "../lib/experimentConcurrency.js";
import type * as lib_labels from "../lib/labels.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_vectorSearch from "../lib/vectorSearch.js";
import type * as lib_vision from "../lib/vision.js";
import type * as lib_workpool from "../lib/workpool.js";
import type * as livechat_actions from "../livechat/actions.js";
import type * as livechat_orchestration from "../livechat/orchestration.js";

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
  config: typeof config;
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
  env: typeof env;
  "evaluator/actions": typeof evaluator_actions;
  "evaluator/crud": typeof evaluator_crud;
  "evaluator/metrics": typeof evaluator_metrics;
  "evaluator/parseJudge": typeof evaluator_parseJudge;
  "evaluator/splits": typeof evaluator_splits;
  "experiments/agentActions": typeof experiments_agentActions;
  "experiments/agentResults": typeof experiments_agentResults;
  "experiments/orchestration": typeof experiments_orchestration;
  "failureModes/actions": typeof failureModes_actions;
  "failureModes/crud": typeof failureModes_crud;
  http: typeof http;
  "kb/chunks": typeof kb_chunks;
  "kb/core": typeof kb_core;
  "kb/core_actions": typeof kb_core_actions;
  "kb/crawl": typeof kb_crawl;
  "kb/crawl_actions": typeof kb_crawl_actions;
  "kb/datasets": typeof kb_datasets;
  "kb/dimension_guard": typeof kb_dimension_guard;
  "kb/documents": typeof kb_documents;
  "kb/documents_actions": typeof kb_documents_actions;
  "kb/experimentRuns": typeof kb_experimentRuns;
  "kb/experiment_actions": typeof kb_experiment_actions;
  "kb/experiments": typeof kb_experiments;
  "kb/generation": typeof kb_generation;
  "kb/generation_actions": typeof kb_generation_actions;
  "kb/images": typeof kb_images;
  "kb/images_actions": typeof kb_images_actions;
  "kb/indexing": typeof kb_indexing;
  "kb/indexing_actions": typeof kb_indexing_actions;
  "kb/langsmithRetry": typeof kb_langsmithRetry;
  "kb/langsmith_actions": typeof kb_langsmith_actions;
  "kb/langsmith_sync_retry": typeof kb_langsmith_sync_retry;
  "kb/media_runtime": typeof kb_media_runtime;
  "kb/pipeline_actions": typeof kb_pipeline_actions;
  "kb/providers": typeof kb_providers;
  "kb/questions": typeof kb_questions;
  "kb/reranker_selection": typeof kb_reranker_selection;
  "kb/results": typeof kb_results;
  "kb/retrieval_runtime": typeof kb_retrieval_runtime;
  "kb/retrieve_actions": typeof kb_retrieve_actions;
  "kb/retrievers": typeof kb_retrievers;
  "kb/tarser_callback": typeof kb_tarser_callback;
  "kb/tarser_nonce": typeof kb_tarser_nonce;
  "kb/vector_backend": typeof kb_vector_backend;
  "lib/agentLoop": typeof lib_agentLoop;
  "lib/auth": typeof lib_auth;
  "lib/auth/tenant": typeof lib_auth_tenant;
  "lib/contentCap": typeof lib_contentCap;
  "lib/docId": typeof lib_docId;
  "lib/experimentConcurrency": typeof lib_experimentConcurrency;
  "lib/labels": typeof lib_labels;
  "lib/validators": typeof lib_validators;
  "lib/vectorSearch": typeof lib_vectorSearch;
  "lib/vision": typeof lib_vision;
  "lib/workpool": typeof lib_workpool;
  "livechat/actions": typeof livechat_actions;
  "livechat/orchestration": typeof livechat_orchestration;
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
  imageProcessingPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"imageProcessingPool">;
};
