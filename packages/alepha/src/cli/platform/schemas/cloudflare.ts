import type { Static } from "alepha";
import { t } from "alepha";

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const cloudflareAccountSchema = t.object({
  id: t.string(),
  name: t.string(),
});

export type CloudflareAccount = Static<typeof cloudflareAccountSchema>;

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------

export const cloudflareD1Schema = t.object({
  uuid: t.string(),
  name: t.string(),
});

export type CloudflareD1 = Static<typeof cloudflareD1Schema>;

// ---------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------

export const cloudflareKVSchema = t.object({
  id: t.string(),
  title: t.string(),
});

export type CloudflareKV = Static<typeof cloudflareKVSchema>;

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

export const cloudflareR2Schema = t.object({
  name: t.string(),
  creation_date: t.optional(t.string()),
});

export type CloudflareR2 = Static<typeof cloudflareR2Schema>;

export const cloudflareR2ListSchema = t.object({
  buckets: t.array(cloudflareR2Schema),
});

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export const cloudflareQueueSchema = t.object({
  queue_id: t.string(),
  queue_name: t.string(),
});

export type CloudflareQueue = Static<typeof cloudflareQueueSchema>;

export const cloudflareQueueConsumerSchema = t.object({
  consumer_id: t.string(),
  service: t.string(),
  environment: t.optional(t.string()),
});

export type CloudflareQueueConsumer = Static<
  typeof cloudflareQueueConsumerSchema
>;

// ---------------------------------------------------------------------------
// Hyperdrive
// ---------------------------------------------------------------------------

export const cloudflareHyperdriveOriginSchema = t.object({
  host: t.string(),
});

export const cloudflareHyperdriveSchema = t.object({
  id: t.string(),
  name: t.string(),
  origin: cloudflareHyperdriveOriginSchema,
});

export type CloudflareHyperdrive = Static<typeof cloudflareHyperdriveSchema>;

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export const cloudflareWorkerSchema = t.object({
  id: t.string(),
  created_on: t.string(),
  modified_on: t.string(),
});

export type CloudflareWorker = Static<typeof cloudflareWorkerSchema>;

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export const cloudflareDeploymentVersionSchema = t.object({
  version_id: t.string(),
  percentage: t.number(),
});

export const cloudflareDeploymentSchema = t.object({
  id: t.string(),
  versions: t.array(cloudflareDeploymentVersionSchema),
  created_on: t.string(),
});

export type CloudflareDeployment = Static<typeof cloudflareDeploymentSchema>;

export const cloudflareDeploymentListSchema = t.object({
  deployments: t.array(cloudflareDeploymentSchema),
});

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const cloudflareVersionSchema = t.object({
  id: t.string(),
  metadata: t.object({
    created_on: t.string(),
  }),
  annotations: t.optional(t.record(t.string(), t.string())),
});

export type CloudflareVersion = Static<typeof cloudflareVersionSchema>;

export const cloudflareVersionListSchema = t.object({
  items: t.array(cloudflareVersionSchema),
});

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

export const cloudflareSecretSchema = t.object({
  name: t.string(),
  type: t.string(),
});

export type CloudflareSecret = Static<typeof cloudflareSecretSchema>;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const createD1BodySchema = t.object({
  name: t.string(),
  primary_location_hint: t.optional(t.string()),
  jurisdiction: t.optional(t.string()),
});

export const createKVBodySchema = t.object({
  title: t.string(),
});

export const createR2BodySchema = t.object({
  name: t.string(),
});

export const createQueueBodySchema = t.object({
  queue_name: t.string(),
});

export const createHyperdriveOriginSchema = t.object({
  scheme: t.string(),
  host: t.string(),
  port: t.number(),
  database: t.string(),
  user: t.string(),
  password: t.string(),
});

export const createHyperdriveBodySchema = t.object({
  name: t.string(),
  origin: createHyperdriveOriginSchema,
});

export const putSecretBodySchema = t.object({
  name: t.string(),
  text: t.string(),
  type: t.string(),
});

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export const cloudflareApiErrorSchema = t.object({
  code: t.number(),
  message: t.string(),
});

export type CloudflareApiError = Static<typeof cloudflareApiErrorSchema>;
