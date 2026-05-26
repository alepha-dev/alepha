import { type Static, t } from "alepha";

/**
 * What the caller (Alepha Club's platform worker, or any other consumer)
 * sends to Rocket to start a deploy run.
 */
export const createDeploySchema = t.object({
  /**
   * Operation. `up` runs the full provision → migrate → deploy → secrets
   * pipeline against the supplied pre-built artifact. `down` tears the
   * environment back down (deletes worker + bindings). `migrate` runs
   * only the migration step. `secrets` syncs the env's secrets to the
   * deployed worker without redeploying code.
   */
  op: t.enum(["up", "down", "migrate", "secrets"]),

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
  op: t.enum(["up", "down", "migrate", "secrets"]),
  project: t.text(),
  env: t.text(),
  status: deployStatusSchema,
  /**
   * Append-only log buffer. Trimmed to a bounded size to avoid
   * unbounded memory growth on long-running deploys.
   */
  log: t.text(),
  /**
   * Final URL of the deployed worker, parsed from the platform
   * orchestrator output. Populated on `succeeded`.
   */
  deployedUrl: t.optional(t.text()),
  error: t.optional(t.text()),
  startedAt: t.datetime(),
  finishedAt: t.optional(t.datetime()),
});
export type Deploy = Static<typeof deploySchema>;
