import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * Where a desktop app reads and writes, by identifier.
 *
 * - resources: `<Name>.app/Contents/Resources`, derived from the executable's
 *   own location and never from the working directory, which Finder sets to
 *   `/` and a shell sets to anything. Read-only.
 * - data: `~/Library/Application Support/<identifier>`, owner-only.
 * - logs: `~/Library/Logs/<identifier>`, owner-only.
 */
export class DesktopPaths {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * The user's home. A field, so a spec can point it elsewhere.
   */
  public home = homedir();

  /**
   * The running executable. A field, so a spec can point it elsewhere.
   */
  public execPath = process.execPath;

  /**
   * Change the working directory. A field, so a spec can record it instead.
   */
  public changeDirectory = (dir: string): void => process.chdir(dir);

  public dataDir(identifier: string): string {
    return join(this.home, "Library", "Application Support", identifier);
  }

  public logDir(identifier: string): string {
    return join(this.home, "Library", "Logs", identifier);
  }

  public logFile(identifier: string): string {
    return join(this.logDir(identifier), "app.log");
  }

  public lockFile(identifier: string): string {
    return join(this.dataDir(identifier), "instance.lock");
  }

  /**
   * `Contents/Resources` when the executable sits in `Contents/MacOS` of a
   * bundle, else the executable's own directory.
   */
  public resourcesDir(): string {
    const dir = dirname(this.execPath);
    if (dir.endsWith(".app/Contents/MacOS")) {
      return join(dirname(dir), "Resources");
    }
    return dir;
  }

  /**
   * Work from the read-only resources: the app reads `migrations/` (and any
   * other file it opens by relative path) from inside the bundle, whatever
   * directory Finder or a shell launched it from.
   */
  public enterResources(): void {
    this.changeDirectory(this.resourcesDir());
  }

  /**
   * Create the data and log directories, owner-only.
   */
  public async prepare(identifier: string): Promise<void> {
    await this.fs.mkdir(this.dataDir(identifier), {
      recursive: true,
      mode: 0o700,
    });
    await this.fs.mkdir(this.logDir(identifier), {
      recursive: true,
      mode: 0o700,
    });
  }
}
