/**
 * Minimal LLM interface for pipeline stages.
 * Provider-agnostic — callers provide their own implementation.
 */
export interface PipelineLLM {
  readonly name: string;
  complete(prompt: string): Promise<string>;
}
