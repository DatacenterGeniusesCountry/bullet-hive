import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../types";
import { R2_CONTENT_THRESHOLD } from "../types";
import { syncBodySchema, type Promotion } from "../schemas";
import { checkDuplicateWithEmbedding } from "../embeddings";

const sync = new Hono<{ Bindings: Env }>();

sync.post("/", zValidator("json", syncBodySchema), async (c) => {
  const body = c.req.valid("json");
  const { agent_id, reports, promotions } = body;

  let syncedReports = 0;
  let syncedPromotions = 0;
  const duplicates: string[] = [];

  // Process reports: batch upsert votes and recalculate bullet counters
  if (reports.length > 0) {
    const reportStatements = reports.flatMap((report) => [
      // Upsert into bullet_votes
      c.env.DB.prepare(
        `INSERT INTO bullet_votes (bullet_id, agent_id, helpful_total, harmful_total, last_synced_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(bullet_id, agent_id)
         DO UPDATE SET
           helpful_total = helpful_total + ?,
           harmful_total = harmful_total + ?,
           last_synced_at = datetime('now')`
      ).bind(
        report.bullet_id,
        agent_id,
        report.helpful_delta,
        report.harmful_delta,
        report.helpful_delta,
        report.harmful_delta
      ),
      // Recalculate bullet aggregates from all agent votes
      c.env.DB.prepare(
        `UPDATE bullets SET
           helpful = (SELECT COALESCE(SUM(helpful_total), 0) FROM bullet_votes WHERE bullet_id = ?),
           harmful = (SELECT COALESCE(SUM(harmful_total), 0) FROM bullet_votes WHERE bullet_id = ?),
           verified_agents = (SELECT COUNT(DISTINCT agent_id) FROM bullet_votes WHERE bullet_id = ?),
           updated_at = datetime('now')
         WHERE id = ?`
      ).bind(report.bullet_id, report.bullet_id, report.bullet_id, report.bullet_id),
    ]);

    await c.env.DB.batch(reportStatements);
    syncedReports = reports.length;
  }

  // Process promotions: same as publish but batched
  for (const promo of promotions) {
    const result = await processPromotion(c.env, promo, agent_id);
    if (result.isDuplicate) {
      duplicates.push(result.bulletId);
    } else {
      syncedPromotions++;
    }
  }

  return c.json({
    synced_reports: syncedReports,
    synced_promotions: syncedPromotions,
    duplicates,
  });
});

interface PromotionResult {
  isDuplicate: boolean;
  bulletId: string;
}

async function processPromotion(
  env: Env,
  promo: Promotion,
  sourceAgent: string
): Promise<PromotionResult> {
  // Check for near-duplicates (also returns the embedding)
  const dupCheck = await checkDuplicateWithEmbedding(
    env.VECTORIZE,
    env.AI,
    promo.content
  );
  if (dupCheck.isDuplicate && dupCheck.existingId) {
    return { isDuplicate: true, bulletId: dupCheck.existingId };
  }

  // Insert into D1 first (source of truth)
  const tagsJson = JSON.stringify(promo.tags);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO bullets (id, section, content, tags, scope, helpful, harmful, source_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      promo.id,
      promo.section,
      promo.content,
      tagsJson,
      promo.scope,
      promo.helpful,
      promo.harmful,
      sourceAgent
    )
    .run();

  // Best-effort secondary writes: Vectorize and R2
  try {
    await env.VECTORIZE.upsert([
      {
        id: promo.id,
        values: dupCheck.embedding,
        metadata: {
          section: promo.section,
          scope: promo.scope,
        },
      },
    ]);
  } catch (e) {
    console.error(`Vectorize upsert failed for promotion ${promo.id}:`, e);
  }

  if (promo.content.length > R2_CONTENT_THRESHOLD) {
    try {
      const payload = JSON.stringify({
        ...promo,
        source_agent: sourceAgent,
      });
      await env.R2.put(`bullets/${promo.id}.json`, payload, {
        httpMetadata: { contentType: "application/json" },
      });
    } catch (e) {
      console.error(`R2 put failed for promotion ${promo.id}:`, e);
    }
  }

  return { isDuplicate: false, bulletId: promo.id };
}

export default sync;
