import type { Static } from "alepha";
import { z } from "alepha";

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const cloudflareAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type CloudflareAccount = Static<typeof cloudflareAccountSchema>;

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------

export const cloudflareD1Schema = z.object({
  uuid: z.string(),
  name: z.string(),
});

export type CloudflareD1 = Static<typeof cloudflareD1Schema>;

// ---------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------

export const cloudflareKVSchema = z.object({
  id: z.string(),
  title: z.string(),
});

export type CloudflareKV = Static<typeof cloudflareKVSchema>;

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

export const cloudflareR2Schema = z.object({
  name: z.string(),
  creation_date: z.string().optional(),
});

export type CloudflareR2 = Static<typeof cloudflareR2Schema>;

export const cloudflareR2ListSchema = z.object({
  buckets: z.array(cloudflareR2Schema),
});

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export const cloudflareQueueSchema = z.object({
  queue_id: z.string(),
  queue_name: z.string(),
});

export type CloudflareQueue = Static<typeof cloudflareQueueSchema>;

export const cloudflareQueueConsumerSchema = z.object({
  consumer_id: z.string(),
  service: z.string(),
  environment: z.string().optional(),
});

export type CloudflareQueueConsumer = Static<
  typeof cloudflareQueueConsumerSchema
>;

// ---------------------------------------------------------------------------
// Hyperdrive
// ---------------------------------------------------------------------------

export const cloudflareHyperdriveOriginSchema = z.object({
  host: z.string(),
});

export const cloudflareHyperdriveSchema = z.object({
  id: z.string(),
  name: z.string(),
  origin: cloudflareHyperdriveOriginSchema,
});

export type CloudflareHyperdrive = Static<typeof cloudflareHyperdriveSchema>;

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export const cloudflareWorkerSchema = z.object({
  id: z.string(),
  created_on: z.string(),
  modified_on: z.string(),
});

export type CloudflareWorker = Static<typeof cloudflareWorkerSchema>;

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export const cloudflareDeploymentVersionSchema = z.object({
  version_id: z.string(),
  percentage: z.number(),
});

export const cloudflareDeploymentSchema = z.object({
  id: z.string(),
  versions: z.array(cloudflareDeploymentVersionSchema),
  created_on: z.string(),
});

export type CloudflareDeployment = Static<typeof cloudflareDeploymentSchema>;

export const cloudflareDeploymentListSchema = z.object({
  deployments: z.array(cloudflareDeploymentSchema),
});

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const cloudflareVersionSchema = z.object({
  id: z.string(),
  metadata: z.object({
    created_on: z.string(),
  }),
  annotations: z.record(z.string(), z.string()).optional(),
});

export type CloudflareVersion = Static<typeof cloudflareVersionSchema>;

export const cloudflareVersionListSchema = z.object({
  items: z.array(cloudflareVersionSchema),
});

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

export const cloudflareSecretSchema = z.object({
  name: z.string(),
  type: z.string(),
});

export type CloudflareSecret = Static<typeof cloudflareSecretSchema>;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const createD1BodySchema = z.object({
  name: z.string(),
  primary_location_hint: z.string().optional(),
  jurisdiction: z.string().optional(),
});

export const createKVBodySchema = z.object({
  title: z.string(),
});

export const createR2BodySchema = z.object({
  name: z.string(),
});

// ---------------------------------------------------------------------------
// R2 API token (used by CLI teardown to wipe a bucket via the S3 protocol;
// minted from a wrangler bearer token, revoked immediately after use)
// ---------------------------------------------------------------------------

export const cloudflareR2TokenSchema = z.object({
  id: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
});

export type CloudflareR2Token = Static<typeof cloudflareR2TokenSchema>;

export const createR2TokenBodySchema = z.object({
  name: z.string(),
  policies: z.array(
    z.object({
      effect: z.string(),
      permissions: z.array(z.string()),
      buckets: z.array(z.string()).optional(),
    }),
  ),
});

export const createQueueBodySchema = z.object({
  queue_name: z.string(),
});

export const createHyperdriveOriginSchema = z.object({
  scheme: z.string(),
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
});

export const createHyperdriveBodySchema = z.object({
  name: z.string(),
  origin: createHyperdriveOriginSchema,
});

export const putSecretBodySchema = z.object({
  name: z.string(),
  text: z.string(),
  type: z.string(),
});

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export const cloudflareApiErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

export type CloudflareApiError = Static<typeof cloudflareApiErrorSchema>;
