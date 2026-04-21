import type { ClassificationTemplate } from "./types.js";

export function buildClassificationPrompt(template: ClassificationTemplate): string {
  const sections: string[] = [];

  sections.push(`You are classifying customer support chat messages. Each message gets exactly one label.`);
  sections.push(``);

  // User categories
  sections.push(`## User Message Categories`);
  sections.push(`For messages from the user, assign one of these labels:`);
  sections.push(``);
  for (const cat of template.categories) {
    sections.push(`### ${cat.id}`);
    sections.push(cat.description);
    if (cat.examples.length > 0) {
      sections.push(`Examples:`);
      for (const ex of cat.examples) {
        sections.push(`- "${ex.message}" (${ex.role})`);
      }
    }
    sections.push(``);
  }

  // Agent roles
  sections.push(`## Agent Message Roles`);
  sections.push(`For messages from the agent (human_agent), assign one of these labels:`);
  sections.push(``);
  for (const role of template.agentRoles) {
    sections.push(`### ${role.id}`);
    sections.push(role.description);
    sections.push(``);
  }

  // Disambiguation rules
  sections.push(`## Disambiguation Rules`);
  for (const rule of template.disambiguationRules) {
    sections.push(`- ${rule}`);
  }
  sections.push(``);

  // Follow-up detection
  sections.push(`## Follow-Up Detection`);
  sections.push(`For each user message labeled "question" or "request", determine if it is a follow-up to a previous exchange in the same conversation.`);
  sections.push(`A message is a follow-up if it:`);
  sections.push(`- References something discussed earlier ("that", "this", "the same one")`);
  sections.push(`- Would be unclear or ambiguous without the preceding context`);
  sections.push(`- Corrects or clarifies a previous message`);
  sections.push(`- Provides feedback on the agent's previous response`);
  sections.push(``);
  sections.push(`If isFollowUp is true, set followUpType to one of: "clarification", "correction", "feedback"`);
  sections.push(`If isFollowUp is true, also provide standaloneVersion: rewrite the message as a complete, self-contained question/request that includes all necessary context from the conversation. It should read as if the user asked it without any prior conversation. Keep it crisp and natural — like a real user would phrase it.`);
  sections.push(``);

  // Intent open code
  sections.push(`## Intent Open Code`);
  sections.push(`For user messages labeled "question" or "request", generate an intentOpenCode: a short snake_case phrase (2-4 words) summarizing the specific intent. Examples: "pricing_inquiry", "plan_upgrade", "billing_dispute", "coverage_area", "esim_activation".`);
  sections.push(``);

  // Confidence
  sections.push(`## Confidence`);
  sections.push(`Set confidence to "high" when you are certain of the classification. Set to "low" when the message is ambiguous or could reasonably belong to a different category.`);

  return sections.join("\n");
}

export function buildToolSchema(template: ClassificationTemplate) {
  const allLabels = [
    ...template.categories.map(c => c.id),
    ...template.agentRoles.map(r => r.id),
  ];

  return {
    name: "classify_messages",
    description: "Classify each message in the conversation",
    input_schema: {
      type: "object" as const,
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              messageId: { type: "number" },
              label: { type: "string", enum: allLabels },
              intentOpenCode: { type: "string" },
              confidence: { type: "string", enum: ["high", "low"] },
              isFollowUp: { type: "boolean" },
              followUpType: { type: "string", enum: ["clarification", "correction", "feedback"] },
              standaloneVersion: { type: "string" },
            },
            required: ["messageId", "label", "confidence", "isFollowUp"],
          },
        },
      },
      required: ["messages"],
    },
  };
}
