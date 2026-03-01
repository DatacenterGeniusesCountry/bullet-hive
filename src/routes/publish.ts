import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../types";
import { R2_CONTENT_THRESHOLD } from "../types";
import { publishBodySchema } from "../schemas";
import { checkDuplicateWithEmbedding } from "../embeddings";

const publish = new Hono<{ Bindings: Env }>();

publish.post("/", zValidator("json", publishBodySchema), async (c) => {
  const body = c.req.valid("json");
  const { bullet, source_agent } = body;

  // Check for near-duplicates via Vectorize (also returns the embedding)
  const dupCheck = await checkDuplicateWithEmbedding(
    c.env.VECTORIZE,
    c.env.AI,
    bullet.content
  );
  if (dupCheck.isDuplicate && dupCheck.existingId) {
    return c.json({
      success: true,
      bullet_id: dupCheck.existingId,
      is_duplicate: true,
    });
  }

  // Insert into D1 first (source of truth)
  const tagsJson = JSON.stringify(bullet.tags);
  await c.env.DB.prepare(
    `INSERT INTO bullets (id, section, content, tags, scope, source_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(bullet.id, bullet.section, bullet.content, tagsJson, bullet.scope, source_agent ?? null)
    .run();

  // Best-effort secondary writes: Vectorize and R2
  // If these fail, D1 is the source of truth and cron can reconcile later
  try {
    await c.env.VECTORIZE.upsert([
      {
        id: bullet.id,
        values: dupCheck.embedding,
        metadata: {
          section: bullet.section,
          scope: bullet.scope,
        },
      },
    ]);
  } catch (e) {
    console.error(`Vectorize upsert failed for ${bullet.id}:`, e);
  }

  if (bullet.content.length > R2_CONTENT_THRESHOLD) {
    try {
      const payload = JSON.stringify({
        ...bullet,
        tags: bullet.tags,
        source_agent,
      });
      await c.env.R2.put(`bullets/${bullet.id}.json`, payload, {
        httpMetadata: { contentType: "application/json" },
      });
    } catch (e) {
      console.error(`R2 put failed for ${bullet.id}:`, e);
    }
  }

  return c.json({
    success: true,
    bullet_id: bullet.id,
    is_duplicate: false,
  });
});

export default publish;
