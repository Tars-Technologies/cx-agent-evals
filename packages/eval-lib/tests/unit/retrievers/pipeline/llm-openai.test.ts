import { describe, it, expect, vi } from "vitest";
import { OpenAIPipelineLLM } from "../../../../src/retrievers/pipeline/llm-openai.js";

function mockOpenAIClient(response: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: response } }],
        }),
      },
    },
  };
}

describe("OpenAIPipelineLLM", () => {
  it("should set name from model", () => {
    const client = mockOpenAIClient("test");
    const llm = new OpenAIPipelineLLM(client);
    expect(llm.name).toBe("OpenAI(gpt-4o-mini)");
  });

  it("should use custom model name", () => {
    const client = mockOpenAIClient("test");
    const llm = new OpenAIPipelineLLM(client, { model: "gpt-4o" });
    expect(llm.name).toBe("OpenAI(gpt-4o)");
  });

  it("should call chat.completions.create with correct params", async () => {
    const client = mockOpenAIClient("the answer");
    const llm = new OpenAIPipelineLLM(client, {
      model: "gpt-4o-mini",
      temperature: 0.3,
    });

    const result = await llm.complete("What is 2+2?");

    expect(result).toBe("the answer");
    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is 2+2?" }],
      temperature: 0.3,
    });
  });

  it("should use default temperature 0.2", async () => {
    const client = mockOpenAIClient("response");
    const llm = new OpenAIPipelineLLM(client);

    await llm.complete("test");

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.2 }),
    );
  });

  it("should return empty string when content is null", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: null } }],
          }),
        },
      },
    };
    const llm = new OpenAIPipelineLLM(client);

    const result = await llm.complete("test");
    expect(result).toBe("");
  });

  it("should implement PipelineLLM interface", () => {
    const client = mockOpenAIClient("test");
    const llm = new OpenAIPipelineLLM(client);

    expect(llm.name).toBeDefined();
    expect(typeof llm.complete).toBe("function");
  });
});
