import { type Infer, z } from "alepha";

/**
 * What an inspectable process writes to `<runDir>/<runId>.json` on start.
 *
 * The file is named by `runId`, never the pid: every container's main process
 * is pid 1, so two containers sharing a bind-mounted run directory would
 * otherwise overwrite each other's entry.
 */
export const inspectorRunEntrySchema = z.object({
  /**
   * 8 random base36 characters. Names both this file and the socket.
   */
  runId: z.text(),
  /**
   * The `name` of the nearest `package.json` above `cwd`, else its basename.
   */
  name: z.text(),
  cwd: z.text(),
  /**
   * The nearest ancestor of `cwd` holding `.git` (a directory, or a
   * worktree's file). Absent outside a repository.
   */
  gitRoot: z.text().optional(),
  pid: z.integer(),
  mode: z.enum(["development", "production"]),
  alephaVersion: z.text(),
  /**
   * The inspector protocol this process speaks. See `INSPECTOR_PROTOCOL`.
   */
  protocol: z.integer(),
  /**
   * ISO 8601.
   */
  startedAt: z.text(),
  /**
   * The socket's FILE NAME, relative to the run directory. A container writes
   * `/root/.alepha/run/x.sock`, a path the host cannot open, so the reader
   * resolves the name against the directory it found the entry in.
   */
  socket: z.text(),
  /**
   * Absolute path of the log file the process persists to, which outlives it.
   */
  logFile: z.text().optional(),
});

export type InspectorRunEntry = Infer<typeof inspectorRunEntrySchema>;
