import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

import { LogFileProvider } from "../providers/LogFileProvider.ts";

/**
 * The app's log file: `~/Library/Logs/<identifier>/app.log`, plus one
 * previous file, `app.log.1`.
 *
 * {@link open} rotates a file that reached {@link maxBytes}, then points
 * stdout and stderr at it. The supervisor Worker calls {@link rotate} once a
 * minute while the app runs, so a long session stays bounded too: at most
 * about twice {@link maxBytes} on disk.
 *
 * Logging never stops the app: a file that cannot be written leaves output
 * where it was, and the failure is reported on stderr.
 */
export class DesktopLogs {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly files = $inject(LogFileProvider);

  /**
   * The size at which the file rotates: 10 MiB.
   */
  public maxBytes = 10 * 1024 * 1024;

  /**
   * Rotate if needed, then send stdout and stderr to `file`. False when the
   * file could not be used.
   */
  public async open(file: string): Promise<boolean> {
    try {
      await this.rotateFile(file);
      await this.files.redirect(file);
      return true;
    } catch (error) {
      console.error(`Cannot write the log file ${file}:`, error);
      return false;
    }
  }

  /**
   * Rotate `file` when it reached {@link maxBytes}, and point the output at
   * the new file. What the supervisor calls periodically.
   */
  public async rotate(file: string): Promise<void> {
    try {
      if (await this.rotateFile(file)) {
        await this.files.redirect(file);
      }
    } catch (error) {
      console.error(`Cannot rotate the log file ${file}:`, error);
    }
  }

  /**
   * Move `file` to `file.1`, replacing the previous backup, when it is at
   * least {@link maxBytes}. True when it rotated.
   */
  protected async rotateFile(file: string): Promise<boolean> {
    if (!(await this.fs.exists(file))) {
      return false;
    }
    const { size } = await this.fs.stat(file);
    if (size < this.maxBytes) {
      return false;
    }
    const backup = `${file}.1`;
    await this.fs.rm(backup, { force: true });
    await this.fs.cp(file, backup);
    await this.fs.rm(file);
    return true;
  }
}
