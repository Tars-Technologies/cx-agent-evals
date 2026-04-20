import type { ClassificationTemplate } from "../types.js";

export const EVAL_DATASET_EXTRACTION: ClassificationTemplate = {
  id: "eval-dataset-extraction",
  name: "Eval Dataset Extraction",
  description: "Focused classification for extracting questions and requests to build RAG evaluation datasets",
  categories: [
    {
      id: "question",
      name: "Question",
      description: "User asks a factual question seeking information. These become eval dataset entries: real questions that an AI agent should be able to answer from a knowledge base.",
      examples: [
        { message: "What are the available 5G plans and their prices?", role: "user" },
        { message: "Does my plan include international roaming?", role: "user" },
        { message: "How long does it take to process a refund?", role: "user" },
      ],
    },
    {
      id: "request",
      name: "Request",
      description: "User wants an action performed. These represent tasks an AI agent should handle: activating services, processing changes, scheduling appointments.",
      examples: [
        { message: "I'd like to upgrade to the Plus plan please", role: "user" },
        { message: "Can you activate international roaming on my number?", role: "user" },
        { message: "Please cancel my subscription", role: "user" },
      ],
    },
    {
      id: "other",
      name: "Other",
      description: "Everything else: greetings, closings, confirmations, identity info, small talk. Not useful for eval dataset extraction.",
      examples: [
        { message: "Hi, good morning", role: "user" },
        { message: "Yes, that's correct", role: "user" },
        { message: "+974 5512 3456", role: "user" },
        { message: "Thank you, goodbye", role: "user" },
      ],
    },
  ],
  agentRoles: [
    { id: "response", name: "Response", description: "Agent responds to user's question or request." },
    { id: "proactive", name: "Proactive", description: "Agent initiates: asks for info, offers something." },
    { id: "procedural", name: "Procedural", description: "Scripted messages: greetings, closings, holds." },
  ],
  disambiguationRules: [
    "If phrased as a question but intent is action → 'request'.",
    "If both question and request in one message → 'request' (action is primary).",
    "Greetings, closings, confirmations, identity sharing → all are 'other'.",
    "When uncertain between 'question' and 'other': if it could generate a useful eval test case, it's a 'question'.",
  ],
};
