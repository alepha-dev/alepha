import type { Infer } from "alepha";
import { z } from "alepha";

// ---------------------------------------------------------------------------
// Status output
// ---------------------------------------------------------------------------

export const platformStatusWorkerSchema = z.object({
  name: z.string(),
  exists: z.boolean(),
  id: z.string().optional(),
  detail: z.string().optional(),
  version: z.string().optional(),
  tag: z.string().optional(),
  createdAt: z.string().optional(),
});

export const platformStatusResourceSchema = z.object({
  name: z.string(),
  exists: z.boolean(),
  id: z.string().optional(),
  detail: z.string().optional(),
});

export const platformStatusSecretSchema = z.object({
  name: z.string(),
  deployed: z.boolean(),
});

export const platformStatusSchema = z.object({
  project: z.string(),
  env: z.string(),
  adapter: z.string(),
  workers: z.array(platformStatusWorkerSchema),
  databases: z.array(platformStatusResourceSchema),
  buckets: z.array(platformStatusResourceSchema),
  kvNamespaces: z.array(platformStatusResourceSchema),
  queues: z.array(platformStatusResourceSchema),
  secrets: z.array(platformStatusSecretSchema),
});

export type PlatformStatusOutput = Infer<typeof platformStatusSchema>;

// ---------------------------------------------------------------------------
// Plan output
// ---------------------------------------------------------------------------

export const platformPlanAppResourcesSchema = z.object({
  hasDatabase: z.boolean(),
  hasBucket: z.boolean(),
  hasAnalytics: z.boolean(),
  hasKV: z.boolean(),
  hasQueue: z.boolean(),
  hasCron: z.boolean(),
});

export const platformPlanAppSchema = z.object({
  name: z.string(),
  path: z.string(),
  resources: platformPlanAppResourcesSchema,
});

export const platformPlanEnvironmentSchema = z.object({
  adapter: z.string(),
  domain: z.string().optional(),
  zone: z.string().optional(),
});

export const platformPlanResourceSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const platformPlanSchema = z.object({
  project: z.string(),
  env: z.string(),
  mode: z.enum(["monorepo", "standalone"]),
  apps: z.array(platformPlanAppSchema),
  environments: z.record(z.string(), platformPlanEnvironmentSchema),
  resources: z.array(platformPlanResourceSchema),
  secretCount: z.number(),
});

export type PlatformPlanOutput = Infer<typeof platformPlanSchema>;
