/**
 * Pure function that composes a system prompt from structured agent config.
 * No "use node" dependencies — importable from actions, mutations, and tests.
 */

interface AgentPromptConfig {
  identity: {
    agentName: string;
    companyName: string;
    companyUrl?: string;
    companyContext?: string;
    roleDescription: string;
    brandVoice?: string;
  };
  guardrails: {
    outOfScope?: string;
    escalationRules?: string;
    compliance?: string;
  };
  responseStyle: {
    formatting?: string;
    length?: string;
    formality?: string;
    language?: string;
  };
  enableReflection: boolean;
  additionalInstructions?: string;
}

interface RetrieverInfo {
  name: string;
  kbName: string;
  description?: string;
}

export function composeSystemPrompt(
  agent: AgentPromptConfig,
  retrievers: RetrieverInfo[],
): string {
  const sections: string[] = [];

  // Identity
  const identityLines = [
    `# Identity`,
    `You are ${agent.identity.agentName}, a customer support agent for ${agent.identity.companyName}.`,
    agent.identity.roleDescription,
  ];
  if (agent.identity.companyContext) {
    identityLines.push("", `## About ${agent.identity.companyName}`, agent.identity.companyContext);
  }
  if (agent.identity.brandVoice) {
    identityLines.push("", `## Voice & Tone`, agent.identity.brandVoice);
  }
  sections.push(identityLines.join("\n"));

  // Response Style
  const styleLines: string[] = [];
  if (agent.responseStyle.formality) styleLines.push(`Formality: ${agent.responseStyle.formality}`);
  if (agent.responseStyle.length) styleLines.push(`Response length: ${agent.responseStyle.length}`);
  if (agent.responseStyle.formatting) styleLines.push(`Formatting: ${agent.responseStyle.formatting}`);
  if (agent.responseStyle.language) styleLines.push(`Always respond in: ${agent.responseStyle.language}`);
  if (styleLines.length > 0) {
    sections.push(`# Response Style\n${styleLines.join("\n")}`);
  }

  // Guardrails
  const guardrailParts: string[] = [];
  if (agent.guardrails.outOfScope) {
    guardrailParts.push(
      `## Out of Scope\nThe following topics are outside your scope. Politely decline and explain you cannot help with these:\n${agent.guardrails.outOfScope}`,
    );
  }
  if (agent.guardrails.escalationRules) {
    guardrailParts.push(`## Escalation\n${agent.guardrails.escalationRules}`);
  }
  if (agent.guardrails.compliance) {
    guardrailParts.push(`## Compliance\n${agent.guardrails.compliance}`);
  }
  if (guardrailParts.length > 0) {
    sections.push(`# Guardrails\n${guardrailParts.join("\n\n")}`);
  }

  // Tools
  if (retrievers.length > 0) {
    const toolLines = retrievers.map((r) => {
      const desc = r.description ?? `Searches ${r.kbName}`;
      return `- **${r.name}** (${r.kbName}): ${desc}`;
    });
    sections.push(
      `# Tools\nYou have access to the following retrieval tools to search the knowledge base:\n${toolLines.join("\n")}\n\nUse these tools when you need factual information to answer the user's question. You may call one, multiple, or no tools depending on the query. Do not fabricate information — if you cannot find a relevant answer in the retrieved content, say so honestly.`,
    );
  }

  // Self-Evaluation
  if (agent.enableReflection) {
    sections.push(
      `# Self-Evaluation\nBefore delivering your final answer, briefly assess:\n1. Is the answer grounded in retrieved content (factual accuracy)?\n2. Does it comply with the guardrails above?\n3. Is it helpful and complete?\nIf not, revise before responding.`,
    );
  }

  // Additional Instructions
  if (agent.additionalInstructions) {
    sections.push(`# Additional Instructions\n${agent.additionalInstructions}`);
  }

  return sections.join("\n\n");
}
