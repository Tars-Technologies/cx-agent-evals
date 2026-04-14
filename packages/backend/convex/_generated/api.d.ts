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
import type * as crons from "../crons.js";
import type * as crud_agents from "../crud/agents.js";
import type * as crud_conversations from "../crud/conversations.js";
import type * as crud_datasets from "../crud/datasets.js";
import type * as crud_documents from "../crud/documents.js";
import type * as crud_knowledgeBases from "../crud/knowledgeBases.js";
import type * as crud_questions from "../crud/questions.js";
import type * as crud_retrievers from "../crud/retrievers.js";
import type * as crud_users from "../crud/users.js";
import type * as experiments_actions from "../experiments/actions.js";
import type * as experiments_agentActions from "../experiments/agentActions.js";
import type * as experiments_agentResults from "../experiments/agentResults.js";
import type * as experiments_orchestration from "../experiments/orchestration.js";
import type * as experiments_results from "../experiments/results.js";
import type * as generation_actions from "../generation/actions.js";
import type * as generation_orchestration from "../generation/orchestration.js";
import type * as langsmith_retry from "../langsmith/retry.js";
import type * as langsmith_sync from "../langsmith/sync.js";
import type * as langsmith_syncRetry from "../langsmith/syncRetry.js";
import type * as lib_auth from "../lib/auth.js";
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
  crons: typeof crons;
  "crud/agents": typeof crud_agents;
  "crud/conversations": typeof crud_conversations;
  "crud/datasets": typeof crud_datasets;
  "crud/documents": typeof crud_documents;
  "crud/knowledgeBases": typeof crud_knowledgeBases;
  "crud/questions": typeof crud_questions;
  "crud/retrievers": typeof crud_retrievers;
  "crud/users": typeof crud_users;
  "experiments/actions": typeof experiments_actions;
  "experiments/agentActions": typeof experiments_agentActions;
  "experiments/agentResults": typeof experiments_agentResults;
  "experiments/orchestration": typeof experiments_orchestration;
  "experiments/results": typeof experiments_results;
  "generation/actions": typeof generation_actions;
  "generation/orchestration": typeof generation_orchestration;
  "langsmith/retry": typeof langsmith_retry;
  "langsmith/sync": typeof langsmith_sync;
  "langsmith/syncRetry": typeof langsmith_syncRetry;
  "lib/auth": typeof lib_auth;
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
  agentExperimentPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"agentExperimentPool">;
  livechatAnalysisPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"livechatAnalysisPool">;
};
