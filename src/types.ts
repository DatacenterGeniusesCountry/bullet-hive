export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  R2: R2Bucket;
  AI: Ai;
}

export interface BulletRow {
  id: string;
  section: string;
  content: string;
  tags: string; // JSON array stored as text
  scope: string;
  helpful: number;
  harmful: number;
  verified_agents: number;
  global_score: number;
  source_agent: string | null;
  created_at: string;
  updated_at: string;
  deprecated: number;
}

export interface BulletVoteRow {
  bullet_id: string;
  agent_id: string;
  helpful_total: number;
  harmful_total: number;
  last_synced_at: string;
}

export const VALID_SECTIONS = [
  "strategies",
  "snippets",
  "mistakes",
  "heuristics",
  "context",
  "others",
] as const;

export type Section = (typeof VALID_SECTIONS)[number];

export const VALID_SCOPES = [
  "universal",
  "language_specific",
  "framework_specific",
  "project_specific",
] as const;

export type Scope = (typeof VALID_SCOPES)[number];

export const COSINE_DUPLICATE_THRESHOLD = 0.88;
export const MAX_CONTENT_LENGTH = 500;
export const R2_CONTENT_THRESHOLD = 200;
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5" as const;
export const EMBEDDING_DIMS = 768;
export const DEFAULT_FETCH_LIMIT = 20;
export const DEPRECATION_SCORE_THRESHOLD = -5;
export const DEPRECATION_AGENTS_THRESHOLD = 5;
export const DEDUP_BATCH_LIMIT = 100;
