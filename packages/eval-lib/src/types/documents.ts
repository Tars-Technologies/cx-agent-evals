import { z } from "zod";
import type { DocumentId } from "./primitives.js";
import { DocumentId as DocumentIdFactory } from "./primitives.js";

export const DocumentSchema = z
  .object({
    id: z.string(),
    content: z.string(),
    metadata: z.record(z.unknown()).default({}),
  })
  .readonly();

export const CorpusSchema = z
  .object({
    documents: z.array(DocumentSchema).readonly(),
    metadata: z.record(z.unknown()).default({}),
  })
  .readonly();

export interface Document {
  readonly id: DocumentId;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Corpus {
  readonly documents: readonly Document[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export function createDocument(params: {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Document {
  return {
    id: DocumentIdFactory(params.id),
    content: params.content,
    metadata: Object.freeze(params.metadata ?? {}),
  };
}

export function createCorpus(documents: Document[], metadata?: Record<string, unknown>): Corpus {
  return {
    documents: Object.freeze([...documents]),
    metadata: Object.freeze(metadata ?? {}),
  };
}

/**
 * Create a Corpus from plain document objects (no filesystem access).
 * Use this in environments without Node.js fs APIs (e.g., Convex actions).
 */
export function createCorpusFromDocuments(
  docs: ReadonlyArray<{
    id: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>,
  metadata?: Record<string, unknown>,
): Corpus {
  const documents = docs.map((d) =>
    createDocument({ id: d.id, content: d.content, metadata: d.metadata }),
  );
  return createCorpus(documents, metadata);
}

export function getDocument(corpus: Corpus, docId: DocumentId): Document | undefined {
  return corpus.documents.find((doc) => doc.id === docId);
}
