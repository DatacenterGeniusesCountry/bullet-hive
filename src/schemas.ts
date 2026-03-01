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
  tags: z.array(z.string().min(1).max(50)).max(20),
  scope: scopeEnum,
});

export const publishBodySchema = z.object({
  bullet: bulletSchema,
  source_agent: z.string().min(1).max(100).optional(),
});

export type PublishBody = z.infer<typeof publishBodySchema>;

export const fetchBodySchema = z.object({
  env_fingerprint: z.object({
    languages: z.array(z.string().max(50)).max(20),
    frameworks: z.array(z.string().max(50)).max(20),
    project: z.string().max(100),
  }),
  known_ids: z.array(z.string().max(100)).max(200).default([]),
  limit: z.number().int().min(1).max(100).default(20),
});

export type FetchBody = z.infer<typeof fetchBodySchema>;

const reportSchema = z.object({
  bullet_id: z.string().min(1).max(100),
  helpful_delta: z.number().int().min(0).max(10),
  harmful_delta: z.number().int().min(0).max(10),
});

const promotionSchema = z.object({
  id: z.string().min(1).max(100),
  section: sectionEnum,
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  tags: z.array(z.string().min(1).max(50)).max(20),
  scope: scopeEnum,
  helpful: z.number().int().min(0).default(0),
  harmful: z.number().int().min(0).default(0),
});

export const syncBodySchema = z.object({
  agent_id: z.string().min(1).max(100),
  env_fingerprint: z.object({
    languages: z.array(z.string().max(50)).max(20),
    frameworks: z.array(z.string().max(50)).max(20),
    project: z.string().max(100),
  }),
  reports: z.array(reportSchema).max(100).default([]),
  promotions: z.array(promotionSchema).max(20).default([]),
});

export type SyncBody = z.infer<typeof syncBodySchema>;
export type Promotion = z.infer<typeof promotionSchema>;
