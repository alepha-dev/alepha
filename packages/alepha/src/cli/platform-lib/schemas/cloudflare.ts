import type { Infer } from "alepha";
import { z } from "alepha";

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const cloudflareAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type CloudflareAccount = Infer<typeof cloudflareAccountSchema>;

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------

export const cloudflareD1Schema = z.object({
  uuid: z.string(),
  name: z.string(),
});

export type CloudflareD1 = Infer<typeof cloudflareD1Schema>;

/**
 * The body of `POST /accounts/{id}/d1/database/{id}/query`.
 *
 * One string, and no `params`: a migration file is DDL, so there is nothing to
 * bind, and a placeholder array would invite somebody to split the file into
 * one statement per request - which is what takes a table rebuild's
 * `PRAGMA foreign_keys=OFF` out of force before its own `DROP TABLE` runs.
 */
export const d1QueryBodySchema = z.object({
  sql: z.string(),
});

/**
 * One statement's answer. D1 returns an array of these, one per statement in
 * the submitted SQL.
 *
 * `results` is left as a loose array because a migration file's statements are
 * DDL and answer nothing; only the two bookkeeping SELECTs read it, and they
 * narrow their own rows.
 */
export const d1QueryResultSchema = z.object({
  success: z.boolean().optional(),
  results: z.array(z.record(z.text(), z.any())).optional(),
});

export type CloudflareD1QueryResult = Infer<typeof d1QueryResultSchema>;

/**
 * One step of D1's file-import flow: `init`, `ingest` or `poll`.
 *
 * Loosely typed on purpose. The three actions answer overlapping shapes -
 * `init` may carry an upload URL or not, `poll` carries a status and a
 * bookmark - and pinning a union here would refuse a response D1 is entitled
 * to widen. What the caller reads is checked where it reads it.
 */
export interface CloudflareD1Import {
  upload_url?: string;
  filename?: string;
  status?: string;
  at_bookmark?: string;
  errors?: string[];
}

// ---------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------

export const cloudflareKVSchema = z.object({
  id: z.string(),
  title: z.string(),
});

export type CloudflareKV = Infer<typeof cloudflareKVSchema>;

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

export const cloudflareR2Schema = z.object({
  name: z.string(),
  creation_date: z.string().optional(),
});

export type CloudflareR2 = Infer<typeof cloudflareR2Schema>;

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

export type CloudflareQueue = Infer<typeof cloudflareQueueSchema>;

export const cloudflareQueueConsumerSchema = z.object({
  consumer_id: z.string(),
  service: z.string(),
  environment: z.string().optional(),
});

export type CloudflareQueueConsumer = Infer<
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

export type CloudflareHyperdrive = Infer<typeof cloudflareHyperdriveSchema>;

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export const cloudflareWorkerSchema = z.object({
  id: z.string(),
  created_on: z.string(),
  modified_on: z.string(),
});

export type CloudflareWorker = Infer<typeof cloudflareWorkerSchema>;

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

export type CloudflareDeployment = Infer<typeof cloudflareDeploymentSchema>;

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

export type CloudflareVersion = Infer<typeof cloudflareVersionSchema>;

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

export type CloudflareSecret = Infer<typeof cloudflareSecretSchema>;

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

export type CloudflareR2Token = Infer<typeof cloudflareR2TokenSchema>;

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

export type CloudflareApiError = Infer<typeof cloudflareApiErrorSchema>;
