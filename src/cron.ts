import type { Env, BulletRow } from "./types";
import {
  DEPRECATION_SCORE_THRESHOLD,
  DEPRECATION_AGENTS_THRESHOLD,
  COSINE_DUPLICATE_THRESHOLD,
  DEDUP_BATCH_LIMIT,
} from "./types";
import { generateEmbedding } from "./embeddings";

export async function handleCron(env: Env): Promise<void> {
  await recalculateGlobalScores(env);
  await deprecateBadBullets(env);
  await deduplicateBullets(env);
}

interface ScoreRow {
  id: string;
  helpful: number;
  harmful: number;
  verified_agents: number;
}

async function recalculateGlobalScores(env: Env): Promise<void> {
  // SQLite does not have ln(), so we compute in JavaScript
  const bullets = await env.DB.prepare(
    `SELECT id, helpful, harmful, verified_agents
     FROM bullets
     WHERE deprecated = 0`
  ).all<ScoreRow>();

  if (bullets.results.length === 0) return;

  const statements = bullets.results.map((b) => {
    const score = (b.helpful - b.harmful) * Math.log(b.verified_agents + 1);
    return env.DB.prepare(
      `UPDATE bullets SET global_score = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(score, b.id);
  });

  await env.DB.batch(statements);
}

async function deprecateBadBullets(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE bullets
     SET deprecated = 1, updated_at = datetime('now')
     WHERE deprecated = 0
       AND global_score < ?
       AND verified_agents > ?`
  )
    .bind(DEPRECATION_SCORE_THRESHOLD, DEPRECATION_AGENTS_THRESHOLD)
    .run();
}

async function deduplicateBullets(env: Env): Promise<void> {
  // Get non-deprecated bullets ordered by global_score DESC
  const bullets = await env.DB.prepare(
    `SELECT id, content, global_score, helpful, harmful, verified_agents
     FROM bullets
     WHERE deprecated = 0
     ORDER BY global_score DESC
     LIMIT 500`
  ).all<Pick<BulletRow, "id" | "content" | "global_score" | "helpful" | "harmful" | "verified_agents">>();

  let dedupCount = 0;
  const processedIds = new Set<string>();

  for (const bullet of bullets.results) {
    if (dedupCount >= DEDUP_BATCH_LIMIT) break;
    if (processedIds.has(bullet.id)) continue;

    // Generate embedding and query for near-duplicates
    const embedding = await generateEmbedding(env.AI, bullet.content);
    const matches = await env.VECTORIZE.query(embedding, {
      topK: 10,
      returnValues: false,
      returnMetadata: "none",
    });

    for (const match of matches.matches) {
      if (dedupCount >= DEDUP_BATCH_LIMIT) break;
      if (match.id === bullet.id || processedIds.has(match.id)) continue;

      if (match.score >= COSINE_DUPLICATE_THRESHOLD) {
        // Current bullet has higher score (sorted DESC), so merge into it
        const dupResult = await env.DB.prepare(
          `SELECT helpful, harmful, verified_agents FROM bullets WHERE id = ?`
        )
          .bind(match.id)
          .first<Pick<BulletRow, "helpful" | "harmful" | "verified_agents">>();

        if (dupResult) {
          // Sum counters into the winner
          await env.DB.prepare(
            `UPDATE bullets SET
               helpful = helpful + ?,
               harmful = harmful + ?,
               updated_at = datetime('now')
             WHERE id = ?`
          )
            .bind(dupResult.helpful, dupResult.harmful, bullet.id)
            .run();

          // Delete the duplicate
          await env.DB.prepare(`DELETE FROM bullets WHERE id = ?`)
            .bind(match.id)
            .run();

          // Remove from Vectorize
          await env.VECTORIZE.deleteByIds([match.id]);

          // Remove from R2 if exists
          await env.R2.delete(`bullets/${match.id}.json`);

          processedIds.add(match.id);
          dedupCount++;
        }
      }
    }

    processedIds.add(bullet.id);
  }
}
