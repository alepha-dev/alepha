import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * Parent directory of vendored packages on the remote. Hardcoded because the
 * Alepha monorepo lays its packages out under `packages/` and the vendor
 * tool only targets that layout.
 */
const REMOTE_DIR = "packages";

/**
 * Options for syncing vendored packages from a remote repository.
 */
export interface VendorSyncOptions {
  root: string;
  remote: string;
  branch: string;
  dir: string;
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
  dir: string;
  packages: string[];
}

/**
 * A single line change within a modified file.
 */
export interface VendorLineDiff {
  line: number;
  type: "added" | "removed";
  text: string;
}

/**
 * A modified file with its line-level changes.
 */
export interface VendorFileDiff {
  file: string;
  changes: VendorLineDiff[];
}

/**
 * Diff result for a single vendored package.
 */
export interface VendorPackageDiff {
  name: string;
  added: string[];
  modified: VendorFileDiff[];
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
 * Shape of the `<dir>/vendor.json` lock file (where `<dir>` is the
 * configured vendor directory, defaulting to `.vendor`).
 */
export interface VendorLock {
  /**
   * Git remote URL the vendored sources were synced from. Recorded so any
   * downstream tool (AI agent, CI script) can re-fetch without needing the
   * project's `alepha.config.ts`.
   */
  remote: string;
  /**
   * Commit hash of the synced sources.
   */
  commit: string;
}

/**
 * Handles syncing and diffing vendored packages from a remote git repository.
 */
export class VendorService {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Sync vendored packages from a remote repository.
   *
   * Without `force`: checks for local modifications by comparing the local
   * copy against the last-synced commit (stored in `<dir>/vendor.json`).
   * If modifications are found, aborts without touching local files.
   *
   * With `force` (or first sync): replaces local copies unconditionally.
   */
  async sync(options: VendorSyncOptions): Promise<VendorSyncResult> {
    const synced: string[] = [];
    const errors: string[] = [];

    if (!options.force) {
      const lock = await this.readLock(options.root, options.dir);

      if (lock) {
        let baselineDir: string | undefined;
        try {
          baselineDir = await this.cloneAtCommit(options.remote, lock.commit);
          const diffResult = await this.diffFromClone(
            options.root,
            baselineDir,
            options.dir,
            options.packages,
          );

          if (diffResult.totalChanges > 0) {
            return { synced: [], errors: [], aborted: diffResult };
          }
        } finally {
          if (baselineDir) {
            await this.fs.rm(baselineDir, { recursive: true, force: true });
          }
        }
      }
    }

    let tmpDir: string | undefined;

    try {
      tmpDir = await this.cloneRemote(options.remote, options.branch);

      for (const pkg of options.packages) {
        const remotePkgDir = this.fs.join(tmpDir, REMOTE_DIR, pkg);
        const localPkgDir = this.fs.join(options.root, options.dir, pkg);

        const remoteExists = await this.fs.exists(remotePkgDir);
        if (!remoteExists) {
          errors.push(`Package "${pkg}" not found in remote`);
          continue;
        }

        this.log.debug(`Syncing package: ${pkg}`);

        await this.fs.rm(localPkgDir, { recursive: true, force: true });
        await this.fs.cp(remotePkgDir, localPkgDir, { recursive: true });
        await this.removeIgnoredFiles(localPkgDir);

        synced.push(pkg);
      }

      const commit = await this.getCommitHash(tmpDir);
      await this.writeLock(options.root, options.dir, {
        remote: options.remote,
        commit,
      });
    } finally {
      if (tmpDir) {
        await this.fs.rm(tmpDir, { recursive: true, force: true });
      }
    }

    return { synced, errors };
  }

  /**
   * Diff vendored packages against the last-synced commit.
   *
   * Reads the commit hash from `<dir>/vendor.json`, clones at that commit,
   * and compares local files to detect modifications since last sync.
   */
  async diff(options: VendorDiffOptions): Promise<VendorDiffResult> {
    const lock = await this.readLock(options.root, options.dir);
    if (!lock) {
      return { packages: [], totalChanges: 0 };
    }

    let tmpDir: string | undefined;

    try {
      tmpDir = await this.cloneAtCommit(options.remote, lock.commit);
      return await this.diffFromClone(
        options.root,
        tmpDir,
        options.dir,
        options.packages,
      );
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
    dir: string,
    packages: string[],
  ): Promise<VendorDiffResult> {
    const results: VendorPackageDiff[] = [];
    let totalChanges = 0;

    for (const pkg of packages) {
      const remotePkgDir = this.fs.join(tmpDir, REMOTE_DIR, pkg);
      const localPkgDir = this.fs.join(root, dir, pkg);

      const remoteExists = await this.fs.exists(remotePkgDir);
      const localExists = await this.fs.exists(localPkgDir);

      if (!remoteExists && !localExists) {
        results.push({ name: pkg, added: [], modified: [], removed: [] });
        continue;
      }

      if (!remoteExists) {
        // No baseline = everything local was added by user
        const localFiles = await this.fs.ls(localPkgDir, { recursive: true });
        results.push({
          name: pkg,
          added: localFiles,
          modified: [],
          removed: [],
        });
        totalChanges += localFiles.length;
        continue;
      }

      if (!localExists) {
        // Baseline exists but local doesn't = user deleted everything
        const remoteFiles = await this.fs.ls(remotePkgDir, { recursive: true });
        results.push({
          name: pkg,
          added: [],
          modified: [],
          removed: remoteFiles,
        });
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
   * Remove test files and ignored directories from a synced package.
   */
  protected async removeIgnoredFiles(pkgDir: string): Promise<void> {
    const allFiles = await this.fs.ls(pkgDir, { recursive: true });

    // Remove ignored files
    for (const file of allFiles) {
      if (
        file.endsWith(".spec.ts") ||
        file.endsWith(".spec.tsx") ||
        file === "LICENSE" ||
        file === "tsdown.config.ts"
      ) {
        await this.fs.rm(this.fs.join(pkgDir, file), { force: true });
      }
    }

    // Remove ignored directories (find all occurrences at any depth)
    for (const file of allFiles) {
      for (const ignored of this.ignoredPaths) {
        if (
          file === ignored ||
          file.startsWith(`${ignored}/`) ||
          file.includes(`/${ignored}/`) ||
          file.endsWith(`/${ignored}`)
        ) {
          // Extract the path to the ignored directory itself
          const idx = file.indexOf(ignored);
          const dirPath = this.fs.join(
            pkgDir,
            file.substring(0, idx + ignored.length),
          );
          await this.fs.rm(dirPath, { recursive: true, force: true });
        }
      }
    }
  }

  /**
   * Clone a remote repository into a temporary directory.
   */
  protected async cloneRemote(remote: string, branch: string): Promise<string> {
    const tmpDir = this.fs.join(
      process.env.TMPDIR || "/tmp",
      `.alepha-vendor-${this.dateTime.nowMillis()}`,
    );

    this.log.debug(`Cloning ${remote}#${branch} into ${tmpDir}`);

    const output = await this.shell.run(
      [
        "git",
        "clone",
        "--depth",
        "1",
        "--branch",
        branch,
        "--filter=blob:none",
        remote,
        tmpDir,
      ],
      { capture: true },
    );

    if (output) {
      this.log.debug(output);
    }

    return tmpDir;
  }

  /**
   * Clone a remote repository at a specific commit hash.
   */
  protected async cloneAtCommit(
    remote: string,
    commit: string,
  ): Promise<string> {
    const tmpDir = this.fs.join(
      process.env.TMPDIR || "/tmp",
      `.alepha-vendor-${this.dateTime.nowMillis()}`,
    );

    this.log.debug(`Cloning ${remote}@${commit} into ${tmpDir}`);

    await this.shell.run(["git", "init", tmpDir], { capture: true });
    await this.shell.run(
      ["git", "-C", tmpDir, "remote", "add", "origin", remote],
      { capture: true },
    );
    await this.shell.run(
      ["git", "-C", tmpDir, "fetch", "--depth", "1", "origin", commit],
      { capture: true },
    );
    await this.shell.run(["git", "-C", tmpDir, "checkout", "FETCH_HEAD"], {
      capture: true,
    });

    return tmpDir;
  }

  /**
   * Get the HEAD commit hash from a cloned repository.
   */
  protected async getCommitHash(repoDir: string): Promise<string> {
    const hash = await this.shell.run(
      ["git", "-C", repoDir, "rev-parse", "HEAD"],
      { capture: true },
    );
    return hash.trim();
  }

  /**
   * Read the vendor lock file at `<root>/<dir>/vendor.json`.
   */
  protected async readLock(
    root: string,
    dir: string,
  ): Promise<VendorLock | undefined> {
    const lockPath = this.fs.join(root, dir, "vendor.json");
    const exists = await this.fs.exists(lockPath);
    if (!exists) {
      return undefined;
    }
    const content = await this.fs.readFile(lockPath);
    return JSON.parse(content.toString());
  }

  /**
   * Write the vendor lock file to `<root>/<dir>/vendor.json`.
   */
  protected async writeLock(
    root: string,
    dir: string,
    lock: VendorLock,
  ): Promise<void> {
    const vendorDir = this.fs.join(root, dir);
    await this.fs.mkdir(vendorDir, { recursive: true });
    await this.fs.writeFile(
      this.fs.join(vendorDir, "vendor.json"),
      JSON.stringify(lock, null, 2),
    );
  }

  /**
   * Directories to ignore during diff comparisons.
   */
  protected readonly ignoredPaths = [
    "__tests__",
    "assets/swagger-ui",
    "node_modules",
    "dist",
  ];

  /**
   * Check if a file path should be ignored during diff.
   */
  protected isIgnored(filePath: string): boolean {
    if (
      filePath.endsWith(".spec.ts") ||
      filePath.endsWith(".spec.tsx") ||
      filePath === "LICENSE" ||
      filePath === "tsdown.config.ts"
    ) {
      return true;
    }
    return this.ignoredPaths.some(
      (p) =>
        filePath === p ||
        filePath.startsWith(`${p}/`) ||
        filePath.includes(`/${p}/`) ||
        filePath.endsWith(`/${p}`),
    );
  }

  /**
   * Recursively compare two directories and return the differences.
   */
  protected async diffDirectories(
    localDir: string,
    remoteDir: string,
  ): Promise<{
    added: string[];
    modified: VendorFileDiff[];
    removed: string[];
  }> {
    const added: string[] = [];
    const modified: VendorFileDiff[] = [];
    const removed: string[] = [];

    const [localFiles, remoteFiles] = await Promise.all([
      this.fs.ls(localDir, { recursive: true }),
      this.fs.ls(remoteDir, { recursive: true }),
    ]);

    const filteredLocal = localFiles.filter((f) => !this.isIgnored(f));
    const filteredRemote = remoteFiles.filter((f) => !this.isIgnored(f));

    const localSet = new Set(filteredLocal);
    const remoteSet = new Set(filteredRemote);

    // Files in baseline but not local = user deleted them
    for (const file of filteredRemote) {
      if (!localSet.has(file)) {
        removed.push(file);
        continue;
      }

      try {
        const [localContent, remoteContent] = await Promise.all([
          this.fs.readFile(this.fs.join(localDir, file)),
          this.fs.readFile(this.fs.join(remoteDir, file)),
        ]);

        if (!localContent.equals(remoteContent)) {
          const changes = this.computeLineDiff(
            remoteContent.toString(),
            localContent.toString(),
          );
          modified.push({ file, changes });
        }
      } catch {
        // Skip directories and unreadable entries
      }
    }

    // Files in local but not baseline = user added them
    for (const file of filteredLocal) {
      if (!remoteSet.has(file)) {
        added.push(file);
      }
    }

    return { added, modified, removed };
  }

  /**
   * Compute line-level differences between two file contents.
   *
   * Uses a longest-common-subsequence algorithm to produce minimal
   * added/removed line changes with accurate line numbers.
   */
  protected computeLineDiff(baseline: string, local: string): VendorLineDiff[] {
    const baseLines = baseline.split("\n");
    const localLines = local.split("\n");
    const lcs = this.longestCommonSubsequence(baseLines, localLines);
    const changes: VendorLineDiff[] = [];

    let bi = 0;
    let li = 0;
    let ci = 0;

    while (bi < baseLines.length || li < localLines.length) {
      if (ci < lcs.length && bi < baseLines.length && li < localLines.length) {
        if (baseLines[bi] === lcs[ci] && localLines[li] === lcs[ci]) {
          // Line is unchanged
          bi++;
          li++;
          ci++;
        } else if (baseLines[bi] !== lcs[ci]) {
          changes.push({ line: bi + 1, type: "removed", text: baseLines[bi] });
          bi++;
        } else {
          changes.push({ line: li + 1, type: "added", text: localLines[li] });
          li++;
        }
      } else if (bi < baseLines.length) {
        changes.push({ line: bi + 1, type: "removed", text: baseLines[bi] });
        bi++;
      } else {
        changes.push({ line: li + 1, type: "added", text: localLines[li] });
        li++;
      }
    }

    return changes;
  }

  /**
   * Compute the longest common subsequence of two string arrays.
   */
  protected longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0),
    );

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    const result: string[] = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return result;
  }
}
