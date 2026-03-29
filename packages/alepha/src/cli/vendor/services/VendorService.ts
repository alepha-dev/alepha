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
}

/**
 * Result of a vendor sync operation.
 */
export interface VendorSyncResult {
  synced: string[];
  errors: string[];
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
   * Shallow-clones the remote, then for each package: removes the local copy
   * and copies the remote copy into place.
   */
  async sync(options: VendorSyncOptions): Promise<VendorSyncResult> {
    const synced: string[] = [];
    const errors: string[] = [];
    let tmpDir: string | undefined;

    try {
      tmpDir = await this.cloneRemote(options.remote, options.branch);

      for (const pkg of options.packages) {
        const remotePkgDir = this.fs.join(tmpDir, "packages", pkg);
        const localPkgDir = this.fs.join(options.root, "packages", pkg);

        const remoteExists = await this.fs.exists(remotePkgDir);
        if (!remoteExists) {
          errors.push(`Package "${pkg}" not found in remote`);
          continue;
        }

        this.log.info(`Syncing package: ${pkg}`);

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
    const packages: VendorPackageDiff[] = [];
    let totalChanges = 0;
    let tmpDir: string | undefined;

    try {
      tmpDir = await this.cloneRemote(options.remote, options.branch);

      for (const pkg of options.packages) {
        const remotePkgDir = this.fs.join(tmpDir, "packages", pkg);
        const localPkgDir = this.fs.join(options.root, "packages", pkg);

        const remoteExists = await this.fs.exists(remotePkgDir);
        const localExists = await this.fs.exists(localPkgDir);

        if (!remoteExists && !localExists) {
          packages.push({ name: pkg, added: [], modified: [], removed: [] });
          continue;
        }

        if (!remoteExists) {
          const localFiles = await this.fs.ls(localPkgDir, { recursive: true });
          packages.push({
            name: pkg,
            added: [],
            modified: [],
            removed: localFiles,
          });
          totalChanges += localFiles.length;
          continue;
        }

        if (!localExists) {
          const remoteFiles = await this.fs.ls(remotePkgDir, {
            recursive: true,
          });
          packages.push({
            name: pkg,
            added: remoteFiles,
            modified: [],
            removed: [],
          });
          totalChanges += remoteFiles.length;
          continue;
        }

        const result = await this.diffDirectories(localPkgDir, remotePkgDir);
        const pkgChanges =
          result.added.length + result.modified.length + result.removed.length;
        totalChanges += pkgChanges;

        packages.push({
          name: pkg,
          added: result.added,
          modified: result.modified,
          removed: result.removed,
        });
      }
    } finally {
      if (tmpDir) {
        await this.fs.rm(tmpDir, { recursive: true, force: true });
      }
    }

    return { packages, totalChanges };
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

    await this.shell.run(
      `git clone --depth 1 --branch ${branch} --filter=blob:none ${remote} ${tmpDir}`,
    );

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
      } else {
        const [localContent, remoteContent] = await Promise.all([
          this.fs.readFile(this.fs.join(localDir, file)),
          this.fs.readFile(this.fs.join(remoteDir, file)),
        ]);

        if (!localContent.equals(remoteContent)) {
          modified.push(file);
        }
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
