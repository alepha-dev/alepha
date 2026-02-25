import type { Static } from "alepha";
import { t } from "alepha";

// ---------------------------------------------------------------------------
// Status output
// ---------------------------------------------------------------------------

export const platformStatusWorkerSchema = t.object({
  name: t.string(),
  exists: t.boolean(),
  id: t.optional(t.string()),
  detail: t.optional(t.string()),
  version: t.optional(t.string()),
  tag: t.optional(t.string()),
  createdAt: t.optional(t.string()),
});

export const platformStatusResourceSchema = t.object({
  name: t.string(),
  exists: t.boolean(),
  id: t.optional(t.string()),
  detail: t.optional(t.string()),
});

export const platformStatusSecretSchema = t.object({
  name: t.string(),
  deployed: t.boolean(),
});

export const platformStatusSchema = t.object({
  project: t.string(),
  env: t.string(),
  adapter: t.string(),
  workers: t.array(platformStatusWorkerSchema),
  databases: t.array(platformStatusResourceSchema),
  buckets: t.array(platformStatusResourceSchema),
  kvNamespaces: t.array(platformStatusResourceSchema),
  queues: t.array(platformStatusResourceSchema),
  secrets: t.array(platformStatusSecretSchema),
});

export type PlatformStatusOutput = Static<typeof platformStatusSchema>;

// ---------------------------------------------------------------------------
// Plan output
// ---------------------------------------------------------------------------

export const platformPlanAppResourcesSchema = t.object({
  hasDatabase: t.boolean(),
  hasBucket: t.boolean(),
  hasKV: t.boolean(),
  hasQueue: t.boolean(),
  hasCron: t.boolean(),
});

export const platformPlanAppSchema = t.object({
  name: t.string(),
  path: t.string(),
  resources: platformPlanAppResourcesSchema,
});

export const platformPlanEnvironmentSchema = t.object({
  adapter: t.string(),
  domain: t.optional(t.string()),
});

export const platformPlanResourceSchema = t.object({
  label: t.string(),
  value: t.string(),
});

export const platformPlanSchema = t.object({
  project: t.string(),
  env: t.string(),
  mode: t.enum(["monorepo", "standalone"]),
  apps: t.array(platformPlanAppSchema),
  environments: t.record(t.string(), platformPlanEnvironmentSchema),
  resources: t.array(platformPlanResourceSchema),
  secretCount: t.number(),
});

export type PlatformPlanOutput = Static<typeof platformPlanSchema>;
