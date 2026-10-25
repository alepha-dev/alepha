/**
 * Points the process's stdout and stderr at a file.
 *
 * A Finder launch hands the process no terminal, so without this every log
 * line (the shell's, the server Worker's, the native bootstrap's) is lost.
 * The redirect is at the descriptor level, process-wide: whatever writes to
 * fd 1 or 2, in any thread, lands in the file, including an app's own console
 * destination. An app that configured another destination keeps it.
 */
export abstract class LogFileProvider {
  /**
   * Append stdout and stderr to `file`, created owner-only.
   */
  public abstract redirect(file: string): Promise<void>;
}
