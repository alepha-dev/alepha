import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * One `alepha capacitor` command at a time per project.
 *
 * Commands rewrite the native projects' identity (a variant switch) and
 * build from them: two at once would build one variant from another's
 * files. The lock is a directory, created atomically, removed when the
 * command ends however it ends. A command that was killed leaves it behind,
 * and the refusal says how to clear it.
 */
export class CapacitorLock {
  public static readonly DIR = ".capacitor-lock";

  protected readonly fs = $inject(FileSystemProvider);

  public async hold<T>(root: string, fn: () => Promise<T>): Promise<T> {
    const path = this.fs.join(root, CapacitorLock.DIR);
    try {
      await this.fs.mkdir(path, { recursive: false, force: false });
    } catch {
      throw new AlephaError(
        `Another alepha capacitor command is running on this project (${CapacitorLock.DIR} exists). Wait for it, or remove ${CapacitorLock.DIR} if no command is running.`,
      );
    }
    try {
      return await fn();
    } finally {
      await this.fs.rm(path, { recursive: true, force: true });
    }
  }
}
