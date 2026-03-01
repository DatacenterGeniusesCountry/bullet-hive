import type { Env, BulletRow, BulletVoteRow } from "./types";
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
  // Only check recently created bullets (last 2 hours) to avoid generating
  // embeddings for every bullet on each cron run. This covers the hourly
  // cron interval with a buffer for retries.
  const bullets = await env.DB.prepare(
    `SELECT id, content, global_score, helpful, harmful, verified_agents
     FROM bullets
     WHERE deprecated = 0
       AND created_at > datetime('now', '-2 hours')
     ORDER BY created_at DESC
     LIMIT 50`
  ).all<Pick<BulletRow, "id" | "content" | "global_score" | "helpful" | "harmful" | "verified_agents">>();

  if (bullets.results.length === 0) return;

  let dedupCount = 0;
  const processedIds = new Set<string>();

  for (const bullet of bullets.results) {
    if (dedupCount >= DEDUP_BATCH_LIMIT) break;
    if (processedIds.has(bullet.id)) continue;

    // Generate embedding for this recent bullet and find near-duplicates
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
        // Determine winner: keep the one with higher global_score
        const dupResult = await env.DB.prepare(
          `SELECT id, helpful, harmful, global_score FROM bullets WHERE id = ?`
        )
          .bind(match.id)
          .first<Pick<BulletRow, "id" | "helpful" | "harmful" | "global_score">>();

        if (!dupResult) continue;

        // Winner keeps, loser merges into winner
        const keepId =
          bullet.global_score >= dupResult.global_score ? bullet.id : dupResult.id;
        const removeId =
          keepId === bullet.id ? match.id : bullet.id;

        // Migrate vote records from loser to winner before deletion
        // (CASCADE would delete them, losing merged vote data)
        const loserVotes = await env.DB.prepare(
          `SELECT agent_id, helpful_total, harmful_total FROM bullet_votes WHERE bullet_id = ?`
        )
          .bind(removeId)
          .all<Pick<BulletVoteRow, "agent_id" | "helpful_total" | "harmful_total">>();

        if (loserVotes.results.length > 0) {
          const voteStatements = loserVotes.results.map((v) =>
            env.DB.prepare(
              `INSERT INTO bullet_votes (bullet_id, agent_id, helpful_total, harmful_total, last_synced_at)
               VALUES (?, ?, ?, ?, datetime('now'))
               ON CONFLICT(bullet_id, agent_id)
               DO UPDATE SET
                 helpful_total = helpful_total + ?,
                 harmful_total = harmful_total + ?,
                 last_synced_at = datetime('now')`
            ).bind(keepId, v.agent_id, v.helpful_total, v.harmful_total, v.helpful_total, v.harmful_total)
          );
          await env.DB.batch(voteStatements);
        }

        // Recalculate winner's aggregates from merged vote records
        await env.DB.prepare(
          `UPDATE bullets SET
             helpful = (SELECT COALESCE(SUM(helpful_total), 0) FROM bullet_votes WHERE bullet_id = ?),
             harmful = (SELECT COALESCE(SUM(harmful_total), 0) FROM bullet_votes WHERE bullet_id = ?),
             verified_agents = (SELECT COUNT(DISTINCT agent_id) FROM bullet_votes WHERE bullet_id = ?),
             updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(keepId, keepId, keepId, keepId)
          .run();

        // Delete the loser (CASCADE will clean up any remaining vote refs)
        await env.DB.prepare(`DELETE FROM bullets WHERE id = ?`)
          .bind(removeId)
          .run();

        // Remove from Vectorize
        await env.VECTORIZE.deleteByIds([removeId]);

        // Remove from R2 if exists
        await env.R2.delete(`bullets/${removeId}.json`);

        processedIds.add(removeId);
        dedupCount++;

        // If we deleted the current outer-loop bullet, stop processing its matches
        if (removeId === bullet.id) {
          break;
        }
      }
    }

    processedIds.add(bullet.id);
  }
}
