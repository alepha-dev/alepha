import { type Infer, z } from "alepha";

/**
 * What Claude Code is doing in a worktree.
 */
export const claudeSessionSchema = z.object({
  /**
   * What Claude is doing here, from the process and the transcript together.
   * A process alone says little: the desktop app keeps one alive per open
   * session, busy or not.
   *
   * - `working`: a Claude process runs here and its transcript was written
   *   in the last two minutes.
   * - `waiting`: a process runs here, but the transcript is quiet: waiting
   *   for its user, or left open.
   * - `stale`: Claude locked the worktree and that process is gone, so git
   *   refuses to remove the worktree until someone unlocks it.
   * - `ended`: no process; only a transcript remains.
   * - `none`: Claude has never been here.
   */
  activity: z.enum(["working", "waiting", "stale", "ended", "none"]),
  /**
   * From the worktree lock Claude Code writes when it creates a worktree:
   * `claude session <name> (pid <n> start <date>)`. `alive` is whether that
   * pid is still a running Claude process.
   */
  lock: z
    .object({
      session: z.string(),
      pid: z.integer(),
      alive: z.boolean(),
    })
    .optional(),
  /**
   * Claude processes whose working directory is inside the worktree. This
   * is how a session that never locked anything, one started in the main
   * checkout, shows up.
   */
  pids: z.array(z.integer()),
  /**
   * The newest session transcript under `~/.claude/projects/` for this path.
   */
  sessionId: z.string().optional(),
  /**
   * The session's title, as named in the app.
   */
  title: z.string().optional(),
  /**
   * When the transcript was last written, ISO 8601.
   */
  lastActivityAt: z.string().optional(),
  /**
   * Tokens the session's last turn sent (input, cache writes and cache
   * reads): how full its context is.
   */
  contextTokens: z.integer().optional(),
  /**
   * The model that answered the last turn.
   */
  model: z.string().optional(),
});

export type ClaudeSession = Infer<typeof claudeSessionSchema>;
