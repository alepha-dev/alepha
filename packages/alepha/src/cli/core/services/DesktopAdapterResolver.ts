import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { $inject, AlephaError } from "alepha";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * What `alepha compile --desktop` asks of `@alepha/desktop/cli`.
 *
 * `alepha` has no dependency on `@alepha/desktop`: the package is resolved
 * from the APP's dependencies at the moment the flag is used, and this
 * structural contract is all the two share. The adapter receives the CLI's
 * file system and shell, so a spec drives it with the memory providers.
 */
export interface DesktopAdapter {
  /**
   * Validate the `desktop` config, the host, the target and the tools the
   * bundle needs. Throws, naming the problem, before anything is written.
   * Answers the validated config.
   */
  preflight(input: {
    root: string;
    config: unknown;
    target: string;
  }): Promise<Record<string, unknown>>;

  /**
   * Write the generated entries into the staged `dist/` and answer their file
   * names, the main (shell) entry first.
   */
  writeEntries(input: {
    dist: string;
    config: Record<string, unknown>;
  }): Promise<string[]>;

  /**
   * Turn the compiled executable at `binary` into the final artifact inside
   * `stage`, and answer its path there.
   */
  assemble(input: {
    root: string;
    stage: string;
    dist: string;
    binary: string;
    name: string;
    config: Record<string, unknown>;
  }): Promise<string>;
}

/**
 * Finds `@alepha/desktop/cli` in the app's own dependencies and builds its
 * adapter with this CLI's file system and shell.
 */
export class DesktopAdapterResolver {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);

  /**
   * The adapter, or an error saying how to install it.
   */
  public async resolve(root: string): Promise<DesktopAdapter> {
    let path: string;
    try {
      path = createRequire(join(root, "package.json")).resolve(
        "@alepha/desktop/cli",
      );
    } catch {
      throw new AlephaError(
        "`alepha compile --desktop` needs @alepha/desktop in this app's dependencies: `yarn add @alepha/desktop` (or npm/pnpm/bun add).",
      );
    }
    const mod = await import(pathToFileURL(path).href);
    if (typeof mod.DesktopCompileAdapter !== "function") {
      throw new AlephaError(
        `@alepha/desktop at ${path} has no DesktopCompileAdapter: its version does not match this alepha.`,
      );
    }
    return new mod.DesktopCompileAdapter({ fs: this.fs, shell: this.shell });
  }
}
