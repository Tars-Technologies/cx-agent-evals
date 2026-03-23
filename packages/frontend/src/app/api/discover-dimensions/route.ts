import { NextRequest, NextResponse } from "next/server";
import { discoverDimensions } from "rag-evaluation-system/pipeline/internals";
import { createLLMClient, getModel } from "rag-evaluation-system/llm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = body.url;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'url' field" },
        { status: 400 },
      );
    }

    const llmClient = createLLMClient();
    const model = getModel({});

    const dimensions = await discoverDimensions({
      url,
      llmClient,
      model,
    });

    return NextResponse.json({ dimensions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dimension discovery failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
