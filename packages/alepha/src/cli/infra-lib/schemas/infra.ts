import type { Infer } from "alepha";
import { z } from "alepha";

// ---------------------------------------------------------------------------
// Status output
// ---------------------------------------------------------------------------

export const infraStatusWorkerSchema = z.object({
  name: z.string(),
  exists: z.boolean(),
  id: z.string().optional(),
  detail: z.string().optional(),
  version: z.string().optional(),
  tag: z.string().optional(),
  createdAt: z.string().optional(),
});

export const infraStatusResourceSchema = z.object({
  name: z.string(),
  exists: z.boolean(),
  id: z.string().optional(),
  detail: z.string().optional(),
});

export const infraStatusSecretSchema = z.object({
  name: z.string(),
  deployed: z.boolean(),
});

export const infraStatusSchema = z.object({
  project: z.string(),
  env: z.string(),
  adapter: z.string(),
  workers: z.array(infraStatusWorkerSchema),
  databases: z.array(infraStatusResourceSchema),
  buckets: z.array(infraStatusResourceSchema),
  kvNamespaces: z.array(infraStatusResourceSchema),
  queues: z.array(infraStatusResourceSchema),
  secrets: z.array(infraStatusSecretSchema),
});

export type InfraStatusOutput = Infer<typeof infraStatusSchema>;

// ---------------------------------------------------------------------------
// Plan output
// ---------------------------------------------------------------------------

export const infraPlanAppResourcesSchema = z.object({
  hasDatabase: z.boolean(),
  hasBucket: z.boolean(),
  hasAnalytics: z.boolean(),
  hasKV: z.boolean(),
  hasQueue: z.boolean(),
  hasCron: z.boolean(),
});

export const infraPlanAppSchema = z.object({
  name: z.string(),
  path: z.string(),
  resources: infraPlanAppResourcesSchema,
});

export const infraPlanEnvironmentSchema = z.object({
  adapter: z.string(),
  domain: z.string().optional(),
});

export const infraPlanResourceSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const infraPlanSchema = z.object({
  project: z.string(),
  env: z.string(),
  mode: z.enum(["monorepo", "standalone"]),
  apps: z.array(infraPlanAppSchema),
  environments: z.record(z.string(), infraPlanEnvironmentSchema),
  resources: z.array(infraPlanResourceSchema),
  secretCount: z.number(),
});

export type InfraPlanOutput = Infer<typeof infraPlanSchema>;
