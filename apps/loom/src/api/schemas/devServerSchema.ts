import { type Infer, z } from "alepha";

/**
 * A process listening on a TCP port with its working directory inside a
 * worktree: in practice, an `alepha dev` or a built server someone started
 * there.
 */
export const devServerSchema = z.object({
  pid: z.integer(),
  command: z.string(),
  port: z.integer(),
  /**
   * The process's working directory.
   */
  cwd: z.string(),
});

export type DevServer = Infer<typeof devServerSchema>;
