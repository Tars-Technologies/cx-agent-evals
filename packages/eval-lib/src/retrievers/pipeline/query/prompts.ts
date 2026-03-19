export const DEFAULT_HYDE_PROMPT =
  `Write a short passage (100-200 words) that would answer the following question. Do not include the question itself, just the answer passage.\n\nQuestion: `;

export const DEFAULT_MULTI_QUERY_PROMPT =
  `Generate {n} different search queries that would help find information to answer the following question. Return one query per line, no numbering.\n\nQuestion: `;

export const DEFAULT_STEP_BACK_PROMPT =
  `Given the following question, generate a more general, abstract version that would retrieve broader background knowledge. Return only the abstract question.\n\nOriginal question: `;

export const DEFAULT_REWRITE_PROMPT =
  `Rewrite the following question to be more precise and optimized for document retrieval. Return only the rewritten question.\n\nOriginal question: `;

// Used by Summary index strategy (Slice 4)
export const DEFAULT_SUMMARY_PROMPT =
  `Write a concise summary (2-3 sentences) of the following text passage. Focus on the key information that would help someone decide if this passage is relevant to their question.\n\nPassage: `;

// Used by Contextual index strategy (Slice 4)
export const DEFAULT_CONTEXT_PROMPT =
  `<document>\n{doc.content}\n</document>\n\nHere is the chunk we want to situate within the whole document:\n<chunk>\n{chunk.content}\n</chunk>\n\nPlease give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;
