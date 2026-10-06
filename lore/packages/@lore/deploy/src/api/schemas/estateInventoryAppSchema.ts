import { type Infer, z } from "alepha";

/**
 * One instance as the machine reports it, wire format v1.
 *
 * ## Truth and intent are two columns
 *
 * `running` and `state` are what the supervisor says right now; `stopped` is
 * what somebody asked for, and it is persisted on the machine. `inactive`
 * with `stopped` is a stop on purpose, `inactive` without it is a process
 * nobody asked to stop, and `failed` is a crash past its restart limit.
 * Collapsing them would have the console say "stopped" about an app that died.
 *
 * ## What is absent and what is zero
 *
 * Everything the supervisor might not know is optional. `runner.Usage` is
 * legitimately nil for a static site or an unsupervised child process, and
 * "0 restarts" from a supervisor that measured nothing is a claim rather than
 * a reading.
 *
 * ## No rendered durations
 *
 * Timestamps only. `bay status` renders "3d" and "12m" for a terminal; a
 * duration frozen at push time is wrong on a page a minute later, so Lore
 * renders its own from these stamps in the viewer's locale.
 *
 * ## Bounds
 *
 * Everything unbounded is bounded, because this schema is the only thing
 * between a machine and the database. `runtime` is carried and never branched
 * on, so a Docker instance validates the day Bay ships that runner.
 */
export const estateInventoryAppSchema = z.object({
  app: z.string().min(1).max(100),
  env: z.string().min(1).max(100),
  runtime: z.string().max(100).optional(),
  release: z.string().max(100).optional(),
  port: z.integer().min(0).max(65535).optional(),
  domains: z.array(z.string().max(253)).max(20).optional(),

  running: z.boolean(),
  /** systemd's ActiveState, verbatim: `active`, `inactive`, `failed`, `activating`. */
  state: z.string().max(100).optional(),
  stopped: z.boolean().optional(),
  static: z.boolean().optional(),

  restarts: z.integer().min(0).optional(),
  startedAt: z.string().max(40).optional(),
  memoryBytes: z.integer().min(0).optional(),
  cpuSeconds: z.number().min(0).optional(),
  tasks: z.integer().min(0).optional(),

  backups: z.boolean(),
  lastBackupAt: z.string().max(40).optional(),
  backupStale: z.boolean().optional(),
  /** The same cap the ack frame puts on `reason`, for the same reason. */
  lastBackupError: z.string().max(2000).optional(),

  lastRequestAt: z.string().max(40).optional(),
  crons: z.integer().min(0).optional(),

  /**
   * The machine's own words, shown verbatim and untranslated. Turning them
   * into codes would mean changing `bay status --json`, which is a documented
   * output read by scripts; Lore draws its localized badges from the booleans
   * beside them instead.
   */
  problems: z.array(z.string().max(300)).max(10),
});

export type EstateInventoryApp = Infer<typeof estateInventoryAppSchema>;
