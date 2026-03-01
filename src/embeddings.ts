import type { Env } from "./types";
import { EMBEDDING_MODEL, COSINE_DUPLICATE_THRESHOLD } from "./types";

export async function generateEmbedding(
  ai: Env["AI"],
  text: string
): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, {
    text: [text],
  });

  if (!("data" in result) || !result.data) {
    throw new Error("Failed to generate embedding: unexpected response format");
  }

  const embedding = result.data[0];
  if (!embedding) {
    throw new Error("Failed to generate embedding: empty data");
  }
  return embedding;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingId: string | null;
}

export interface DuplicateCheckWithEmbeddingResult extends DuplicateCheckResult {
  embedding: number[];
}

export async function checkDuplicateWithEmbedding(
  vectorize: Env["VECTORIZE"],
  ai: Env["AI"],
  content: string,
  excludeId?: string
): Promise<DuplicateCheckWithEmbeddingResult> {
  const embedding = await generateEmbedding(ai, content);

  const results = await vectorize.query(embedding, {
    topK: 5,
    returnValues: false,
    returnMetadata: "none",
  });

  for (const match of results.matches) {
    if (
      match.score >= COSINE_DUPLICATE_THRESHOLD &&
      match.id !== excludeId
    ) {
      return { isDuplicate: true, existingId: match.id, embedding };
    }
  }

  return { isDuplicate: false, existingId: null, embedding };
}
