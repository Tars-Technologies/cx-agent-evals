export type Verdict = { passed: boolean; justification: string };

export function scoreOne(evaluator: any, messages: any[]): Verdict {
  if (evaluator.type === "code" && evaluator.codeJudgeConfig) {
    return scoreCode(evaluator, messages);
  }
  // TODO(future-phase): real LLM judge call. For Phase 1, stub.
  return {
    passed: true,
    justification:
      "[stub] llm_judge scoring pending — real LLM call will be wired in a follow-up phase",
  };
}

function scoreCode(ev: any, messages: any[]): Verdict {
  const cfg = ev.codeJudgeConfig;
  const params = cfg.params ?? {};

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
      return {
        passed,
        justification: passed
          ? `String "${needle}" ${expectPresent ? "was present" : "was absent"} as expected`
          : `String "${needle}" ${present ? "was present" : "was absent"} but expected ${expectPresent ? "present" : "absent"}`,
      };
    }
    case "regex_match": {
      const pattern: string = params.pattern ?? "";
      const expectMatch: boolean = params.expectMatch ?? true;
      const re = params.flags ? new RegExp(pattern, params.flags) : new RegExp(pattern);
      const haystack = messages.map((m: any) => m.content).join("\n");
      const matched = re.test(haystack);
      const passed = matched === expectMatch;
      return {
        passed,
        justification: `Regex /${pattern}/ ${matched ? "matched" : "did not match"} (expected ${expectMatch ? "match" : "no match"})`,
      };
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
      return {
        passed,
        justification: `Tool "${toolName}" ${called ? "was called" : "was not called"} (expected ${expectCalled ? "called" : "not called"})`,
      };
    }
    case "response_format": {
      const mustBeValidJson: boolean = params.mustBeValidJson ?? false;
      const lastAssistant = [...messages]
        .reverse()
        .find((m: any) => m.role === "assistant");
      if (!lastAssistant)
        return { passed: false, justification: "No assistant message to evaluate" };
      if (mustBeValidJson) {
        try {
          JSON.parse(lastAssistant.content);
          return { passed: true, justification: "Assistant response is valid JSON" };
        } catch {
          return { passed: false, justification: "Assistant response is not valid JSON" };
        }
      }
      return { passed: true, justification: "Response format check passed (no constraints)" };
    }
    default:
      return { passed: true, justification: `Unknown checkType: ${cfg.checkType}` };
  }
}
