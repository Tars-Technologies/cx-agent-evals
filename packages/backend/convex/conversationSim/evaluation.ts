// Pure code evaluator functions — no Convex registrations, no Node.js deps.
// Imported by the simulation action (Task 7) which runs in a "use node" file.

export interface EvalInput {
  messages: Array<{ role: string; content: string }>;
  toolCalls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: string;
  }>;
}

export interface EvalResult {
  passed: boolean;
  justification: string;
}

// ─── tool_call_match ───

/**
 * Checks that at least one tool call matches the expected tool name.
 *
 * params.toolName   – expected tool name (if omitted, checks any tool was called)
 * params.minCalls   – minimum number of matching calls (default 1)
 * params.expectedArgs – if provided, check args contain these key-value pairs
 * params.matchMode  – "exact" | "subset" (default "subset")
 */
export function runToolCallMatch(
  params: {
    toolName?: string;
    minCalls?: number;
    expectedArgs?: Record<string, unknown>;
    matchMode?: "exact" | "subset";
  },
  input: EvalInput,
): EvalResult {
  const minCalls = params.minCalls ?? 1;

  let matching = input.toolCalls;

  if (params.toolName) {
    matching = matching.filter((tc) => tc.toolName === params.toolName);
  }

  if (params.expectedArgs) {
    matching = matching.filter((tc) => {
      if (params.matchMode === "exact") {
        return JSON.stringify(tc.args) === JSON.stringify(params.expectedArgs);
      }
      // subset: every expected key exists with the expected value
      return Object.entries(params.expectedArgs!).every(
        ([k, v]) => JSON.stringify(tc.args[k]) === JSON.stringify(v),
      );
    });
  }

  const passed = matching.length >= minCalls;
  return {
    passed,
    justification: passed
      ? `Found ${matching.length} matching tool call(s) (required: ${minCalls})`
      : `Found ${matching.length} matching tool call(s), but required ${minCalls}. Tool calls made: ${input.toolCalls.map((tc) => tc.toolName).join(", ") || "none"}`,
  };
}

// ─── string_contains ───

/**
 * Checks that a target string appears in agent messages or all messages.
 */
export function runStringContains(
  params: {
    target: string;
    caseSensitive?: boolean;
    searchIn?: "agent_messages" | "all_messages";
  },
  input: EvalInput,
): EvalResult {
  const searchIn = params.searchIn ?? "agent_messages";
  const messages =
    searchIn === "agent_messages"
      ? input.messages.filter((m) => m.role === "assistant")
      : input.messages;

  const text = messages.map((m) => m.content).join("\n");
  const target = params.caseSensitive
    ? params.target
    : params.target.toLowerCase();
  const haystack = params.caseSensitive ? text : text.toLowerCase();

  const passed = haystack.includes(target);
  return {
    passed,
    justification: passed
      ? `Found "${params.target}" in ${searchIn}`
      : `Did not find "${params.target}" in ${searchIn}`,
  };
}

// ─── regex_match ───

/**
 * Checks that a regex pattern matches (or doesn't match) in agent messages.
 */
export function runRegexMatch(
  params: {
    pattern: string;
    flags?: string;
    searchIn?: "agent_messages" | "all_messages";
    shouldMatch?: boolean;
  },
  input: EvalInput,
): EvalResult {
  const searchIn = params.searchIn ?? "agent_messages";
  const shouldMatch = params.shouldMatch ?? true;
  const messages =
    searchIn === "agent_messages"
      ? input.messages.filter((m) => m.role === "assistant")
      : input.messages;

  const text = messages.map((m) => m.content).join("\n");
  const regex = new RegExp(params.pattern, params.flags);
  const matches = regex.test(text);

  const passed = shouldMatch ? matches : !matches;
  return {
    passed,
    justification: passed
      ? shouldMatch
        ? `Pattern /${params.pattern}/ matched in ${searchIn}`
        : `Pattern /${params.pattern}/ correctly did not match in ${searchIn}`
      : shouldMatch
        ? `Pattern /${params.pattern}/ did not match in ${searchIn}`
        : `Pattern /${params.pattern}/ unexpectedly matched in ${searchIn}`,
  };
}

// ─── response_format ───

/**
 * Checks response format requirements (non-empty, length limits, JSON validity).
 */
export function runResponseFormat(
  params: {
    requireJson?: boolean;
    requiredFields?: string[];
    requireNonEmpty?: boolean;
    maxLength?: number;
  },
  input: EvalInput,
): EvalResult {
  const agentMessages = input.messages.filter((m) => m.role === "assistant");

  if (agentMessages.length === 0) {
    return { passed: false, justification: "No agent messages found" };
  }

  const lastMessage = agentMessages[agentMessages.length - 1].content;

  if (
    params.requireNonEmpty &&
    (!lastMessage || lastMessage.trim().length === 0)
  ) {
    return { passed: false, justification: "Agent response is empty" };
  }

  if (params.maxLength && lastMessage.length > params.maxLength) {
    return {
      passed: false,
      justification: `Response length ${lastMessage.length} exceeds max ${params.maxLength}`,
    };
  }

  if (params.requireJson) {
    try {
      const parsed = JSON.parse(lastMessage);
      if (params.requiredFields) {
        const missing = params.requiredFields.filter(
          (f) => !(f in (parsed as Record<string, unknown>)),
        );
        if (missing.length > 0) {
          return {
            passed: false,
            justification: `JSON missing required fields: ${missing.join(", ")}`,
          };
        }
      }
    } catch {
      return { passed: false, justification: "Response is not valid JSON" };
    }
  }

  return { passed: true, justification: "Response format checks passed" };
}

// ─── Dispatcher ───

/**
 * Runs the appropriate code evaluator based on checkType.
 */
export function runCodeEvaluator(
  checkType: string,
  params: Record<string, unknown>,
  input: EvalInput,
): EvalResult {
  switch (checkType) {
    case "tool_call_match":
      return runToolCallMatch(
        params as Parameters<typeof runToolCallMatch>[0],
        input,
      );
    case "string_contains":
      return runStringContains(
        params as Parameters<typeof runStringContains>[0],
        input,
      );
    case "regex_match":
      return runRegexMatch(
        params as Parameters<typeof runRegexMatch>[0],
        input,
      );
    case "response_format":
      return runResponseFormat(
        params as Parameters<typeof runResponseFormat>[0],
        input,
      );
    default:
      return {
        passed: false,
        justification: `Unknown check type: ${checkType}`,
      };
  }
}
