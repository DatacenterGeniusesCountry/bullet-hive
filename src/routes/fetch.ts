import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Env, BulletRow } from "../types";
import { fetchBodySchema } from "../schemas";

const fetch_ = new Hono<{ Bindings: Env }>();

fetch_.post("/", zValidator("json", fetchBodySchema), async (c) => {
  const body = c.req.valid("json");
  const { env_fingerprint, known_ids, limit } = body;

  // Build query for non-deprecated bullets, excluding known_ids
  // We fetch more than limit because we filter in-app by scope+tags
  const batchSize = limit * 5;

  // Cap known_ids to stay within SQLite's SQLITE_MAX_VARIABLE_NUMBER (999)
  const cappedIds = known_ids.slice(0, 100);

  let query = `SELECT * FROM bullets WHERE deprecated = 0`;
  const params: (string | number)[] = [];

  if (cappedIds.length > 0) {
    const placeholders = cappedIds.map(() => "?").join(",");
    query += ` AND id NOT IN (${placeholders})`;
    params.push(...cappedIds);
  }

  query += ` ORDER BY global_score DESC LIMIT ?`;
  params.push(batchSize);

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all<BulletRow>();

  // Filter by scope + tag matching, parsing tags once per row
  interface MatchedBullet extends Omit<BulletRow, "tags" | "deprecated"> {
    parsedTags: string[];
  }
  const matched: MatchedBullet[] = [];
  const lowerLanguages = env_fingerprint.languages.map((l) => l.toLowerCase());
  const lowerFrameworks = env_fingerprint.frameworks.map((f) => f.toLowerCase());
  const lowerProject = env_fingerprint.project.toLowerCase();

  for (const row of result.results) {
    if (matched.length >= limit) break;

    let parsedTags: string[];
    try {
      const raw: unknown = JSON.parse(row.tags);
      parsedTags = Array.isArray(raw)
        ? raw.filter((t): t is string => typeof t === "string")
        : [];
    } catch {
      parsedTags = [];
    }

    if (row.scope === "universal") {
      matched.push({ ...row, parsedTags });
      continue;
    }

    const lowerTags = parsedTags.map((t) => t.toLowerCase());

    if (
      row.scope === "language_specific" &&
      lowerTags.some((t) => lowerLanguages.includes(t))
    ) {
      matched.push({ ...row, parsedTags });
    } else if (
      row.scope === "framework_specific" &&
      lowerTags.some((t) => lowerFrameworks.includes(t))
    ) {
      matched.push({ ...row, parsedTags });
    } else if (
      row.scope === "project_specific" &&
      lowerTags.some((t) => t === lowerProject)
    ) {
      matched.push({ ...row, parsedTags });
    }
  }

  const bullets = matched.map((row) => ({
    id: row.id,
    section: row.section,
    content: row.content,
    tags: row.parsedTags,
    scope: row.scope,
    helpful: row.helpful,
    harmful: row.harmful,
    verified_agents: row.verified_agents,
    global_score: row.global_score,
    source_agent: row.source_agent,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return c.json({ success: true, bullets, count: bullets.length });
});

export default fetch_;
