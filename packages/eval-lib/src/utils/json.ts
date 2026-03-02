export function safeParseLLMResponse<T>(response: string, fallback: T): T {
  try {
    const cleaned = response.replace(/^```(?:json)?\n?|\n?```$/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    console.warn("Failed to parse LLM response:", response.slice(0, 200));
    return fallback;
  }
}
