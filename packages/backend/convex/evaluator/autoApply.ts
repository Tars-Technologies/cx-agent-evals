import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

type EvaluatorResult = {
  evaluatorId: Id<"evaluators">;
  evaluatorName: string;
  passed: boolean;
  justification: string;
  required: boolean;
};

export const applyReadyEvaluatorsToSimRun = internalAction({
  args: { simRunId: v.id("conversationSimRuns") },
  handler: async (ctx, { simRunId }) => {
    const simRun = await ctx.runQuery(
      internal.conversationSim.runs.getInternal,
      { id: simRunId },
    );
    if (!simRun || !simRun.conversationId) return;

    const ready = await ctx.runQuery(
      internal.evaluator.crud.byAgentStatusInternal,
      { agentId: simRun.agentId, status: "ready" },
    );
    if (ready.length === 0) return;

    const messages = await ctx.runQuery(
      internal.crud.conversations.listMessagesInternal,
      { conversationId: simRun.conversationId },
    );

    const results: EvaluatorResult[] = [];
    for (const ev of ready) {
      if (ev.type === "code" && ev.codeJudgeConfig) {
        results.push(scoreCodeEvaluator(ev, messages));
      } else {
        // TODO(future-phase): wire LLM-judge scoring (call OpenAI/Anthropic with rubric + transcript,
        // parse pass/fail per dimension). Until then, record a stub so the wiring is observable.
        results.push({
          evaluatorId: ev._id,
          evaluatorName: ev.name,
          passed: true,
          justification:
            "[stub] llm_judge auto-apply pending — real scoring will be wired in a follow-up phase",
          required: false,
        });
      }
    }

    await ctx.runMutation(
      internal.conversationSim.runs.appendEvaluatorResultsInternal,
      { runId: simRunId, results },
    );
  },
});

function scoreCodeEvaluator(ev: any, messages: any[]): EvaluatorResult {
  const cfg = ev.codeJudgeConfig;
  const params = cfg.params ?? {};
  const make = (passed: boolean, justification: string): EvaluatorResult => ({
    evaluatorId: ev._id,
    evaluatorName: ev.name,
    passed,
    justification,
    required: false,
  });

  switch (cfg.checkType) {
    case "string_contains": {
      const needle: string = params.needle ?? "";
      const expectPresent: boolean = params.expectPresent ?? true;
      const roleFilter: string | undefined = params.role;
      const haystack = messages
        .filter((m: any) => !roleFilter || m.role === roleFilter)
        .map((m: any) => m.content)
        .join("\n");
      const present = haystack.includes(needle);
      const passed = present === expectPresent;
      return make(
        passed,
        passed
          ? `String "${needle}" ${expectPresent ? "was present" : "was absent"} as expected`
          : `String "${needle}" ${present ? "was present" : "was absent"} but expected ${expectPresent ? "present" : "absent"}`,
      );
    }
    case "regex_match": {
      const pattern: string = params.pattern ?? "";
      const expectMatch: boolean = params.expectMatch ?? true;
      const re = new RegExp(pattern);
      const haystack = messages.map((m: any) => m.content).join("\n");
      const matched = re.test(haystack);
      const passed = matched === expectMatch;
      return make(
        passed,
        `Regex /${pattern}/ ${matched ? "matched" : "did not match"} (expected ${expectMatch ? "match" : "no match"})`,
      );
    }
    case "tool_call_match": {
      const toolName: string = params.toolName ?? "";
      const called = messages.some(
        (m: any) =>
          m.role === "tool_call" &&
          (m.toolCall?.toolName === toolName ||
            (typeof m.content === "string" && m.content.includes(toolName))),
      );
      const expectCalled: boolean = params.expectCalled ?? true;
      const passed = called === expectCalled;
      return make(
        passed,
        `Tool "${toolName}" ${called ? "was called" : "was not called"} (expected ${expectCalled ? "called" : "not called"})`,
      );
    }
    case "response_format": {
      const mustBeValidJson: boolean = params.mustBeValidJson ?? false;
      const lastAssistant = [...messages]
        .reverse()
        .find((m: any) => m.role === "assistant");
      if (!lastAssistant) return make(false, "No assistant message to evaluate");
      if (mustBeValidJson) {
        try {
          JSON.parse(lastAssistant.content);
          return make(true, "Assistant response is valid JSON");
        } catch {
          return make(false, "Assistant response is not valid JSON");
        }
      }
      return make(true, "Response format check passed (no constraints)");
    }
    default:
      return make(true, `Unknown checkType: ${cfg.checkType}`);
  }
}
