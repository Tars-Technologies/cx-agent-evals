export interface LLMClient {
  readonly name: string;
  complete(params: {
    model: string;
    messages: ReadonlyArray<{ role: string; content: string }>;
    responseFormat?: "json" | "text";
  }): Promise<string>;
}

export function openAIClientAdapter(client: {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        response_format?: { type: string };
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}): LLMClient {
  return {
    name: "OpenAI",
    async complete(params) {
      const response = await client.chat.completions.create({
        model: params.model,
        messages: [...params.messages],
        ...(params.responseFormat === "json"
          ? { response_format: { type: "json_object" } }
          : {}),
      });
      return response.choices[0].message.content ?? "";
    },
  };
}
