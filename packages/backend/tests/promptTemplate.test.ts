import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "../convex/agents/promptTemplate";

const baseAgent = {
  identity: {
    agentName: "Test Bot",
    companyName: "Test Corp",
    roleDescription: "You are a helpful support agent.",
  },
  guardrails: {},
  responseStyle: {},
  enableReflection: false,
  additionalInstructions: undefined,
};

const mockRetrievers = [
  { name: "Product Docs", kbName: "Acme KB", description: undefined },
  { name: "FAQ Search", kbName: "Acme KB", description: "Searches FAQ articles" },
];

describe("composeSystemPrompt", () => {
  it("includes identity section with agent and company name", () => {
    const prompt = composeSystemPrompt(baseAgent, []);
    expect(prompt).toContain("Test Bot");
    expect(prompt).toContain("Test Corp");
    expect(prompt).toContain("You are a helpful support agent.");
  });

  it("omits empty sections", () => {
    const prompt = composeSystemPrompt(baseAgent, []);
    expect(prompt).not.toContain("Guardrails");
    expect(prompt).not.toContain("Response Style");
    expect(prompt).not.toContain("Additional Instructions");
  });

  it("includes guardrails when provided", () => {
    const agent = {
      ...baseAgent,
      guardrails: {
        outOfScope: "competitor pricing",
        escalationRules: "escalate when frustrated",
      },
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("competitor pricing");
    expect(prompt).toContain("escalate when frustrated");
  });

  it("includes response style when provided", () => {
    const agent = {
      ...baseAgent,
      responseStyle: { formality: "professional", length: "concise" },
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("professional");
    expect(prompt).toContain("concise");
  });

  it("lists retriever tools with KB name", () => {
    const prompt = composeSystemPrompt(baseAgent, mockRetrievers);
    expect(prompt).toContain("Product Docs");
    expect(prompt).toContain("Acme KB");
    expect(prompt).toContain("FAQ Search");
    expect(prompt).toContain("Searches FAQ articles");
  });

  it("includes reflection instructions when enabled", () => {
    const agent = { ...baseAgent, enableReflection: true };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("Self-Evaluation");
    expect(prompt).toContain("factual");
  });

  it("excludes reflection instructions when disabled", () => {
    const prompt = composeSystemPrompt(baseAgent, []);
    expect(prompt).not.toContain("Self-Evaluation");
  });

  it("includes additional instructions when provided", () => {
    const agent = {
      ...baseAgent,
      additionalInstructions: "Always greet the user by name.",
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("Always greet the user by name.");
  });

  it("includes company context when provided", () => {
    const agent = {
      ...baseAgent,
      identity: {
        ...baseAgent.identity,
        companyContext: "Acme Corp sells widgets worldwide.",
      },
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("Acme Corp sells widgets worldwide.");
  });

  it("includes brand voice when provided", () => {
    const agent = {
      ...baseAgent,
      identity: {
        ...baseAgent.identity,
        brandVoice: "friendly, professional, concise",
      },
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("friendly, professional, concise");
  });
});
