"use node";

import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  RecursiveCharacterChunker,
  OpenAIEmbedder,
  createDocument,
} from "rag-evaluation-system";
import OpenAI from "openai";

// ─── Helpers ───

function createEmbedder(model?: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const openai = new OpenAI({ apiKey });
  return new OpenAIEmbedder({
    model: model ?? "text-embedding-3-small",
    client: openai,
  });
}

// ─── Index Single Document ───

/**
 * @deprecated Use indexingActions.indexDocument (WorkPool-dispatched, two-phase) instead.
 * Chunk, embed, and insert a single document into documentChunks.
 */
export async function indexSingleDocument(
  ctx: {
    runQuery: (ref: any, args: any) => Promise<any>;
    runMutation: (ref: any, args: any) => Promise<any>;
  },
  docId: Id<"documents">,
  opts: { chunkSize?: number; chunkOverlap?: number; embeddingModel?: string },
) {
  const doc = await ctx.runQuery(internal.documents.getInternal, { id: docId });

  const chunker = new RecursiveCharacterChunker({
    chunkSize: opts.chunkSize ?? 1000,
    chunkOverlap: opts.chunkOverlap ?? 200,
  });

  const evalDoc = createDocument({ id: doc.docId, content: doc.content });
  const chunks = chunker.chunkWithPositions(evalDoc);

  if (chunks.length === 0) {
    return { chunksInserted: 0 };
  }

  const embedder = createEmbedder(opts.embeddingModel);

  // Embed all chunks
  const embeddings = await embedder.embed(
    chunks.map((c) => c.content),
  );

  // Insert chunks with embeddings
  for (let i = 0; i < chunks.length; i++) {
    await ctx.runMutation(internal.rag.insertChunk, {
      documentId: docId,
      kbId: doc.kbId,
      chunkId: chunks[i].id,
      content: chunks[i].content,
      start: chunks[i].start,
      end: chunks[i].end,
      embedding: embeddings[i],
      metadata: chunks[i].metadata ?? {},
    });
  }

  return { chunksInserted: chunks.length };
}
