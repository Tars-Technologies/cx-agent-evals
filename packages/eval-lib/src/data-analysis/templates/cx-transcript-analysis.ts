import type { ClassificationTemplate } from "../types.js";

export const CX_TRANSCRIPT_ANALYSIS: ClassificationTemplate = {
  id: "cx-transcript-analysis",
  name: "CX Transcript Analysis",
  description: "Full 7-category breakdown for customer support conversation analysis",
  categories: [
    {
      id: "question",
      name: "Question",
      description: "User asks a factual question seeking information about products, services, pricing, plans, coverage, features, policies, or procedures.",
      examples: [
        { message: "What are the available 5G plans and their prices?", role: "user" },
        { message: "Does my plan include international roaming?", role: "user" },
        { message: "How long does it take to process a refund?", role: "user" },
      ],
    },
    {
      id: "request",
      name: "Request",
      description: "User wants an action performed: activate/deactivate a service, upgrade/downgrade a plan, get a refund, book an appointment, change settings, or any task that requires the agent to DO something (not just inform).",
      examples: [
        { message: "I'd like to upgrade to the Plus plan please", role: "user" },
        { message: "Can you activate international roaming on my number?", role: "user" },
        { message: "Please cancel my subscription", role: "user" },
      ],
    },
    {
      id: "identity_info",
      name: "Identity Info",
      description: "User shares personal identifying information (name, phone, email, address, ID number) or agent asks for/confirms it.",
      examples: [
        { message: "+974 5512 3456", role: "user" },
        { message: "My name is Ahmed Al-Thani", role: "user" },
        { message: "Can I get your phone number to look up your account?", role: "human_agent" },
      ],
      extractFields: true,
    },
    {
      id: "confirmation",
      name: "Confirmation",
      description: "Simple acknowledgments, yes/no responses, brief confirmations that don't introduce new information or requests.",
      examples: [
        { message: "Yes, that's correct", role: "user" },
        { message: "OK", role: "user" },
        { message: "Got it, thanks", role: "user" },
      ],
    },
    {
      id: "greeting",
      name: "Greeting",
      description: "Hello/welcome/how-are-you exchanges at the start of a conversation. Does NOT include questions that happen to be polite (those are questions).",
      examples: [
        { message: "Hi, good morning", role: "user" },
        { message: "Hello", role: "user" },
      ],
    },
    {
      id: "closing",
      name: "Closing",
      description: "Thank you/goodbye/session-end exchanges.",
      examples: [
        { message: "Great, thank you so much!", role: "user" },
        { message: "That's all I needed, bye", role: "user" },
      ],
    },
    {
      id: "uncategorized",
      name: "Uncategorized",
      description: "Messages that don't clearly fit any other category. Use sparingly — prefer a specific category when possible.",
      examples: [
        { message: "hmm", role: "user" },
        { message: "...", role: "user" },
      ],
    },
  ],
  agentRoles: [
    {
      id: "response",
      name: "Response",
      description: "Agent responds to a user's question or request with information or action confirmation.",
    },
    {
      id: "proactive",
      name: "Proactive",
      description: "Agent initiates: asks for information, offers something unsolicited, requests verification.",
    },
    {
      id: "procedural",
      name: "Procedural",
      description: "Scripted/template messages: greetings, closings, hold messages, transfer notifications.",
    },
  ],
  disambiguationRules: [
    "If a message is phrased as a question but the user's clear intent is to trigger an action (e.g., 'Can you upgrade my plan?'), classify as 'request'.",
    "If a message includes both a question and a request, classify based on the PRIMARY intent. 'What plans do you have and can you switch me?' → 'request' (the switch is the goal).",
    "Politeness formulas like 'Can you help me?' at conversation start are 'greeting', not 'question'.",
    "'How are you?' is 'greeting'. 'How do I reset my password?' is 'question'.",
    "Simple 'yes'/'no'/'ok' after an agent asks something is 'confirmation', not 'request'.",
    "If ambiguous between 'question' and 'confirmation', prefer 'confirmation' for short messages (under 5 words) that follow an agent message.",
  ],
};
