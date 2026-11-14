import { type Infer, z } from "alepha";

/**
 * One instance's backups as the machine reports them: Bay's `InventoryBackup`
 * (`internal/connector/inventory.go`), pinned by `wire-v1/inventory.json`.
 *
 * Bay already cuts every string to 500 characters and every list to 20
 * entries; these bounds are the same, so a frame Bay builds always fits, and
 * one that doesn't is a broken or hostile machine rather than a big app.
 *
 * `state` is the one word to sort and colour by, worst first: `restore-pending`
 * (the app started on an empty data directory while its bucket has backups),
 * `failing`, `stale`, `never`, `off`, `unconfigured`, then `ok`. It is a free
 * string here so a state Bay adds later still renders, verbatim.
 */
const text = z.string().max(500);
const stamp = z.string().max(40);
const count = z.integer().min(0);

export const hostInventoryBackupSchema = z.object({
  state: z.string().min(1).max(40),
  /**
   * The policy in effect, in words, and where each part came from:
   * `builtin`, `global`, `app` (the app's own `bay({ backup })`) or
   * `operator` (set from Lore or `bay backup policy set`).
   */
  policy: z
    .object({
      enabled: z.boolean(),
      schedule: text,
      retention: text,
      everySeconds: count.optional(),
      timezone: z.string().max(100).optional(),
      onDeploy: z.boolean(),
      prune: z.string().max(40).optional(),
      verifyEverySeconds: count.optional(),
      sources: z.record(z.string().max(40), z.string().max(40)).optional(),
    })
    .optional(),
  /** The bucket as Bay last probed it: `ok`, `degraded`, `down` or `unconfigured`. */
  target: z
    .object({
      status: z.string().max(40),
      since: stamp.optional(),
      lastProbeAt: stamp.optional(),
      lastError: text.optional(),
      bucket: z.string().max(255).optional(),
    })
    .optional(),
  nextAt: stamp.optional(),
  last: z
    .object({
      at: stamp,
      key: text,
      kind: z.string().max(40).optional(),
      trigger: z.string().max(40).optional(),
      tag: z.string().max(100).optional(),
      release: z.string().max(100).optional(),
      rawBytes: count.optional(),
      storedBytes: count.optional(),
      durationMs: count.optional(),
      files: count.optional(),
      databases: z
        .array(
          z.object({
            path: text,
            rawBytes: count,
            storedBytes: count,
            sha256: z.string().max(64).optional(),
            integrity: text.optional(),
            tables: count,
            pages: count.optional(),
            pageSize: count.optional(),
            journalMode: z.string().max(40).optional(),
            topTables: z
              .array(z.object({ table: text, rows: count }))
              .max(20)
              .optional(),
            migrations: z
              .array(
                z.object({ table: text, count: count, last: text.optional() }),
              )
              .max(20)
              .optional(),
          }),
        )
        .max(20)
        .optional(),
      anomalies: z.array(text).max(20).optional(),
    })
    .optional(),
  failure: z
    .object({
      at: stamp,
      stage: z.string().max(40).optional(),
      message: text,
      consecutive: count,
    })
    .optional(),
  catalog: z
    .object({
      listedAt: stamp,
      count: count,
      totalBytes: count,
      oldestAt: stamp.optional(),
      newestAt: stamp.optional(),
    })
    .optional(),
  verify: z
    .object({
      at: stamp,
      key: text.optional(),
      ok: z.boolean(),
      error: text.optional(),
    })
    .optional(),
  restore: z
    .object({
      at: stamp,
      key: text.optional(),
      from: z.string().max(200).optional(),
      reason: text.optional(),
      trigger: z.string().max(40).optional(),
      status: z.string().max(40),
      error: text.optional(),
      preRestoreKey: text.optional(),
    })
    .optional(),
  restorePending: z
    .object({ since: stamp, reason: text.optional() })
    .optional(),
  /** Data on the machine no backup covers (uploads, a stray database). */
  notCovered: z.array(text).max(20).optional(),
});

export type HostInventoryBackup = Infer<typeof hostInventoryBackupSchema>;

/**
 * Backup states, worst first: the order the console sorts by, so the app that
 * needs somebody comes to the top. A state not listed sorts after these.
 */
export const BACKUP_STATE_RISK = [
  "restore-pending",
  "failing",
  "stale",
  "never",
  "off",
  "unconfigured",
  "ok",
] as const;
