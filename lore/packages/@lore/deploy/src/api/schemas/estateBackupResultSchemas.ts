import { type Infer, z } from "alepha";

/**
 * What a machine uploads for the backup commands, one schema per kind, each
 * mirroring Bay's `cmd/bay/backupactions.go` and pinned by the fixtures in
 * `test/fixtures/bay/results/` that Bay's `cmd/bay/testdata/results` holds.
 *
 * Bounded like `estateCommandResultSchema`: the payload comes from the
 * machine, and the route's byte cap is the second line, not the first.
 */
const stamp = z.string().max(40);
const text = z.string().max(2000);

/** `backups-list`: the bucket's backups of one instance, newest first. */
export const estateBackupsListResultSchema = z.object({
  catalog: z.object({
    listedAt: stamp,
    count: z.integer().min(0),
    totalBytes: z.integer().min(0),
    oldestAt: stamp.optional(),
    newestAt: stamp.optional(),
  }),
  backups: z
    .array(
      z.object({
        key: z.string().max(500),
        at: stamp,
        bytes: z.integer().min(0),
        kind: z.string().max(40).optional(),
        files: z.integer().min(0).optional(),
        tag: z.string().max(100).optional(),
      }),
    )
    .max(500),
  /** How many older backups were left out to stay under 500. */
  truncated: z.integer().min(0).optional(),
});

export type EstateBackupsListResult = Infer<
  typeof estateBackupsListResultSchema
>;

/** `backup-verify`: a restore test that stops before the app. */
export const estateBackupVerifyResultSchema = z.object({
  app: z.string().max(201),
  ok: z.boolean(),
  key: z.string().max(500).optional(),
  createdAt: stamp.optional(),
  files: z
    .array(
      z.object({
        path: z.string().max(500),
        integrity: text,
        tables: z.integer().min(0),
        /** -1 when the backup has no manifest to compare with. */
        manifestTables: z.integer().min(-1),
      }),
    )
    .max(100)
    .nullable()
    .optional(),
  error: text.optional(),
});

export type EstateBackupVerifyResult = Infer<
  typeof estateBackupVerifyResultSchema
>;

/** `target-probe`: the bucket as the machine sees it after asking it. */
export const estateTargetProbeResultSchema = z.object({
  status: z.string().max(40),
  since: stamp.optional(),
  lastProbeAt: stamp.optional(),
  lastError: text.optional(),
  failures: z.integer().min(0).optional(),
  bucket: z.string().max(255).optional(),
});

export type EstateTargetProbeResult = Infer<
  typeof estateTargetProbeResultSchema
>;

/**
 * `restore`, dry run or real: Bay's restore answer, which `bay restore`
 * prints too (`wouldRestore`, `replaces`, `creates` on a dry run; `restored`,
 * `preRestoreBackup` on a real one). Kept as the machine's own object,
 * because the console shows it as the machine's words.
 */
export const estateRestoreResultSchema = z.record(z.string().max(100), z.any());

export type EstateRestoreResult = Infer<typeof estateRestoreResultSchema>;
