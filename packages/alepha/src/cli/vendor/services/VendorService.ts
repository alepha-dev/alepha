import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * Options for syncing vendored packages from a remote repository.
 */
export interface VendorSyncOptions {
  root: string;
  remote: string;
  branch: string;
  packages: string[];
  force?: boolean;
}

/**
 * Result of a vendor sync operation.
 */
export interface VendorSyncResult {
  synced: string[];
  errors: string[];
  aborted?: VendorDiffResult;
}

/**
 * Options for diffing vendored packages against a remote repository.
 */
export interface VendorDiffOptions {
  root: string;
  remote: string;
  branch: string;
  packages: string[];
}

/**
 * Diff result for a single vendored package.
 */
export interface VendorPackageDiff {
  name: string;
  added: string[];
  modified: string[];
  removed: string[];
}

/**
 * Result of a vendor diff operation.
 */
export interface VendorDiffResult {
  packages: VendorPackageDiff[];
  totalChanges: number;
}

/**
 * Handles syncing and diffing vendored packages from a remote git repository.
 */
export class VendorService {
  protected readonly log = $logger();
  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Sync vendored packages from a remote repository.
   *
   * Shallow-clones the remote once, then:
   * - Without `force`: diffs first. If local modifications exist, aborts
   *   and returns the diff result without touching local files.
   * - With `force` (or no changes): removes local copies and replaces them.
   */
  async sync(options: VendorSyncOptions): Promise<VendorSyncResult> {
    const synced: string[] = [];
    const errors: string[] = [];
    let tmpDir: string | undefined;

    try {
      tmpDir = await this.cloneRemote(options.remote, options.branch);

      if (!options.force) {
        const diffResult = await this.diffFromClone(
          options.root,
          tmpDir,
          options.packages,
        );
        if (diffResult.totalChanges > 0) {
          return { synced: [], errors: [], aborted: diffResult };
        }
      }

      for (const pkg of options.packages) {
        const remotePkgDir = this.fs.join(tmpDir, "packages", pkg);
        const localPkgDir = this.fs.join(options.root, "packages", pkg);

        const remoteExists = await this.fs.exists(remotePkgDir);
        if (!remoteExists) {
          errors.push(`Package "${pkg}" not found in remote`);
          continue;
        }

        this.log.debug(`Syncing package: ${pkg}`);

        await this.fs.rm(localPkgDir, { recursive: true, force: true });
        await this.fs.cp(remotePkgDir, localPkgDir, { recursive: true });

        synced.push(pkg);
      }
    } finally {
      if (tmpDir) {
        await this.fs.rm(tmpDir, { recursive: true, force: true });
      }
    }

    return { synced, errors };
  }

  /**
   * Diff vendored packages against a remote repository.
   *
   * Shallow-clones the remote, then for each package: recursively compares
   * files to identify added, modified, and removed files.
   */
  async diff(options: VendorDiffOptions): Promise<VendorDiffResult> {
    let tmpDir: string | undefined;

    try {
      tmpDir = await this.cloneRemote(options.remote, options.branch);
      return await this.diffFromClone(options.root, tmpDir, options.packages);
    } finally {
      if (tmpDir) {
        await this.fs.rm(tmpDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * Diff local packages against an already-cloned remote.
   */
  protected async diffFromClone(
    root: string,
    tmpDir: string,
    packages: string[],
  ): Promise<VendorDiffResult> {
    const results: VendorPackageDiff[] = [];
    let totalChanges = 0;

    for (const pkg of packages) {
      const remotePkgDir = this.fs.join(tmpDir, "packages", pkg);
      const localPkgDir = this.fs.join(root, "packages", pkg);

      const remoteExists = await this.fs.exists(remotePkgDir);
      const localExists = await this.fs.exists(localPkgDir);

      if (!remoteExists && !localExists) {
        results.push({ name: pkg, added: [], modified: [], removed: [] });
        continue;
      }

      if (!remoteExists) {
        const localFiles = await this.fs.ls(localPkgDir, { recursive: true });
        results.push({ name: pkg, added: [], modified: [], removed: localFiles });
        totalChanges += localFiles.length;
        continue;
      }

      if (!localExists) {
        const remoteFiles = await this.fs.ls(remotePkgDir, { recursive: true });
        results.push({ name: pkg, added: remoteFiles, modified: [], removed: [] });
        totalChanges += remoteFiles.length;
        continue;
      }

      const result = await this.diffDirectories(localPkgDir, remotePkgDir);
      const pkgChanges =
        result.added.length + result.modified.length + result.removed.length;
      totalChanges += pkgChanges;

      results.push({
        name: pkg,
        added: result.added,
        modified: result.modified,
        removed: result.removed,
      });
    }

    return { packages: results, totalChanges };
  }

  /**
   * Clone a remote repository into a temporary directory.
   */
  protected async cloneRemote(remote: string, branch: string): Promise<string> {
    const tmpDir = this.fs.join(
      process.env.TMPDIR || "/tmp",
      `.alepha-vendor-${Date.now()}`,
    );

    this.log.debug(`Cloning ${remote}#${branch} into ${tmpDir}`);

    const output = await this.shell.run(
      `git clone --depth 1 --branch ${branch} --filter=blob:none ${remote} ${tmpDir}`,
      { capture: true },
    );

    if (output) {
      this.log.debug(output);
    }

    return tmpDir;
  }

  /**
   * Recursively compare two directories and return the differences.
   */
  protected async diffDirectories(
    localDir: string,
    remoteDir: string,
  ): Promise<{ added: string[]; modified: string[]; removed: string[] }> {
    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];

    const [localFiles, remoteFiles] = await Promise.all([
      this.fs.ls(localDir, { recursive: true }),
      this.fs.ls(remoteDir, { recursive: true }),
    ]);

    const localSet = new Set(localFiles);
    const remoteSet = new Set(remoteFiles);

    for (const file of remoteFiles) {
      if (!localSet.has(file)) {
        added.push(file);
        continue;
      }

      try {
        const [localContent, remoteContent] = await Promise.all([
          this.fs.readFile(this.fs.join(localDir, file)),
          this.fs.readFile(this.fs.join(remoteDir, file)),
        ]);

        if (!localContent.equals(remoteContent)) {
          modified.push(file);
        }
      } catch {
        // Skip directories and unreadable entries
      }
    }

    for (const file of localFiles) {
      if (!remoteSet.has(file)) {
        removed.push(file);
      }
    }

    return { added, modified, removed };
  }
}
