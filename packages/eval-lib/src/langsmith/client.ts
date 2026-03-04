import { Client } from "langsmith";

/**
 * Create a LangSmith client.
 * Uses LANGSMITH_API_KEY from environment (standard LangSmith SDK behavior).
 */
export function getLangSmithClient(): Client {
  return new Client();
}
