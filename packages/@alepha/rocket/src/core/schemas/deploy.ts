import { type Static, t } from "alepha";

/**
 * What the caller (Alepha Club's platform worker, or any other consumer)
 * sends to Rocket to start a deploy run.
 */
export const createDeploySchema = t.object({
  /**
   * Operation. `up` runs the full provision → build → migrate → deploy
   * → secrets pipeline against the supplied pre-built artifact (no
   * standalone `migrate` / `secrets` ops — they're sub-steps of `up`
   * and the orchestrator is idempotent on already-migrated/synced
   * state). `down` tears the environment back down (deletes worker +
   * bindings).
   */
  op: t.enum(["up", "down"]),

  /**
   * Project identifier. Free-form — Rocket itself doesn't interpret it,
   * it's threaded through to `alepha.config.ts` resolution.
   */
  project: t.text(),

  /**
   * Target environment. Matches a key in the artifact's
   * `alepha.config.ts` `environments` map.
   */
  env: t.text(),

  /**
   * Source of the pre-built artifact. v1 supports S3-compatible buckets
   * (R2, MinIO, AWS S3). The artifact is a `tar.gz` containing `dist/`,
   * `migrations/` and optionally `alepha.config.ts`.
   */
  artifact: t.object({
    bucket: t.text(),
    key: t.text(),
  }),

  /**
   * Per-invocation overrides for the artifact's `alepha.config.ts`.
   * When omitted (and the artifact ships its own `alepha.config.ts`),
   * Rocket uses the bundled config as-is. When supplied, Rocket
   * generates a new `alepha.config.ts` from these values — the
   * multi-tenant deploy path (one artifact, many tenants).
   */
  config: t.optional(
    t.object({
      hostname: t.optional(t.text()),
      vars: t.optional(t.record(t.text(), t.text())),
      secrets: t.optional(t.record(t.text(), t.text())),
    }),
  ),
});
export type CreateDeploy = Static<typeof createDeploySchema>;

export const deployStatusSchema = t.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type DeployStatus = Static<typeof deployStatusSchema>;

/**
 * The state held in `DeployRegistry` and returned by the controller.
 */
export const deploySchema = t.object({
  id: t.uuid(),
  op: t.enum(["up", "down"]),
  project: t.text(),
  env: t.text(),
  status: deployStatusSchema,
  /**
   * Append-only log buffer. Trimmed to a bounded size to avoid
   * unbounded memory growth on long-running deploys (see
   * `DeployRegistry.LOG_MAX_BYTES`). Default `t.text()` caps at 255
   * chars which is way too small — explicit maxLength matches the
   * registry's buffer cap.
   */
  log: t.string({ maxLength: 256 * 1024 }),
  /**
   * Final URL of the deployed worker, parsed from the platform
   * orchestrator output. Populated on `succeeded`.
   */
  deployedUrl: t.optional(t.text()),
  error: t.optional(t.string({ maxLength: 64 * 1024 })),
  startedAt: t.datetime(),
  finishedAt: t.optional(t.datetime()),
});
export type Deploy = Static<typeof deploySchema>;
