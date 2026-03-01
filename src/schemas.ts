import { z } from "zod";
import {
  VALID_SECTIONS,
  VALID_SCOPES,
  MAX_CONTENT_LENGTH,
} from "./types";

const sectionEnum = z.enum(VALID_SECTIONS);
const scopeEnum = z.enum(VALID_SCOPES);

const bulletSchema = z.object({
  id: z.string().min(1).max(100),
  section: sectionEnum,
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  tags: z.array(z.string().min(1).max(50)),
  scope: scopeEnum,
});

export const publishBodySchema = z.object({
  bullet: bulletSchema,
  source_agent: z.string().min(1).max(100).optional(),
});

export type PublishBody = z.infer<typeof publishBodySchema>;

export const fetchBodySchema = z.object({
  env_fingerprint: z.object({
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    project: z.string(),
  }),
  known_ids: z.array(z.string()).default([]),
  limit: z.number().int().min(1).max(100).default(20),
});

export type FetchBody = z.infer<typeof fetchBodySchema>;

const reportSchema = z.object({
  bullet_id: z.string().min(1),
  helpful_delta: z.number().int(),
  harmful_delta: z.number().int(),
});

const promotionSchema = z.object({
  id: z.string().min(1).max(100),
  section: sectionEnum,
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  tags: z.array(z.string().min(1).max(50)),
  scope: scopeEnum,
  helpful: z.number().int().min(0).default(0),
  harmful: z.number().int().min(0).default(0),
});

export const syncBodySchema = z.object({
  agent_id: z.string().min(1).max(100),
  env_fingerprint: z.object({
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    project: z.string(),
  }),
  reports: z.array(reportSchema).default([]),
  promotions: z.array(promotionSchema).default([]),
});

export type SyncBody = z.infer<typeof syncBodySchema>;
export type Promotion = z.infer<typeof promotionSchema>;
