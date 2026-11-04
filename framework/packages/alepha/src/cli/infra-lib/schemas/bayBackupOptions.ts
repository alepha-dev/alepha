import { type Infer, z } from "alepha";

/*
  The backup policy an app declares for one Bay environment, sent with each
  deploy as `bay deploy --backup-policy <json>`.

  It mirrors Bay's `backuppolicy.Policy` field for field, so the JSON is sent
  as-is. Bay is the authority: it treats this layer as untrusted input (keep
  at most 365 per rule, never "keep everything", never bucket-lifecycle
  pruning) and refuses the deploy with the reason when a value is out of
  bounds. The checks here only catch the shape early, before a pack.

  Objects are strict because Bay's decoder refuses unknown fields: a typo
  (`retension`) must fail here, not be silently dropped and then missed.

  What an app can NOT choose is deliberate: the bucket and its credentials
  are the host's (`bay config s3:backups`, `bay config s3:apps`), and what is
  backed up is always the SQLite databases under the app's `data/`.
*/

const count = (max: number) => z.integer().min(0).max(max).optional();

export const bayBackupScheduleSchema = z
  .object({
    /** Interval between two backups, e.g. `"6h"`, `"1d"` (5m to 31d). */
    every: z.text().optional(),
    /** Wall-clock times in `timezone`, e.g. `["03:00", "15:00"]`. */
    at: z.array(z.text()).min(1).optional(),
    /** Five-field cron expression, in `timezone`. */
    cron: z.text().optional(),
    /**
     * IANA timezone (`"Europe/Paris"`). Also where a day, week and month
     * begin for retention. Default UTC.
     */
    timezone: z.text().optional(),
    /**
     * Spreads instances sharing a schedule over this span (at most 6h), by a
     * fixed offset per instance.
     */
    jitter: z.text().optional(),
  })
  .strict()
  .refine(
    (it) =>
      [it.every, it.at, it.cron].filter((v) => v !== undefined).length <= 1,
    { message: "every, at and cron are alternatives; set only one" },
  );

export const bayBackupRetentionSchema = z
  .object({
    /** The newest N backups (1 to 365). */
    keep: z.integer().min(1).max(365).optional(),
    /** The newest backup of each of the last N hours that have one. */
    hourly: count(365),
    /** … of each of the last N days. */
    daily: count(365),
    /** … of each of the last N ISO weeks. */
    weekly: count(365),
    /** … of each of the last N months. */
    monthly: count(365),
    /** … of each of the last N years. */
    yearly: count(365),
    /**
     * Removes backups older than this whatever else keeps them (`"180d"`, at
     * least a day); `"0"` lifts a limit set by the host.
     */
    maxAge: z.text().optional(),
    /** How many pre-deploy backups are kept, apart from the rules above. */
    keepPreDeploy: count(365),
    /** Keeps backups given a name (`bay backup --tag`) out of pruning. */
    keepTagged: z.boolean().optional(),
  })
  .strict();

export const bayBackupOptionsSchema = z
  .object({
    /** Turns scheduled backups on or off for this app. */
    enabled: z.boolean().optional(),
    /** When backups are taken: one of `every`, `at` or `cron`. */
    schedule: bayBackupScheduleSchema.optional(),
    /**
     * Restricts when a scheduled backup may start, `"HH:MM-HH:MM"` in the
     * schedule's timezone (`"01:00-06:00"`); `"any"` lifts the host's window.
     */
    window: z.text().optional(),
    /**
     * Skips a scheduled slot that comes this soon after the last backup,
     * whatever took it (at most 24h).
     */
    minGap: z.text().optional(),
    /**
     * Takes a backup (tagged pre-deploy) before each deploy of an instance
     * that already has data, so a release whose migrations go wrong has its
     * starting point saved.
     */
    onDeploy: z.boolean().optional(),
    /** Which backups survive pruning; a backup is kept when any rule keeps it. */
    retention: bayBackupRetentionSchema.optional(),
    /**
     * The restore test: how often the newest backup is downloaded and
     * checked as a restore would check it (`"168h"`, or `"off"`).
     */
    verify: z.object({ every: z.text().optional() }).strict().optional(),
  })
  .strict();

export type BayBackupOptions = Infer<typeof bayBackupOptionsSchema>;
