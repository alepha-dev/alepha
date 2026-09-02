import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * Decide whether `dist/` still matches the sources it was built from.
 *
 * Backs `alepha build --if-stale`, which exists for one shape: a pipeline that
 * builds and then runs something needing the build. `alepha verify` does
 * exactly that - `yarn build` for every workspace, then `yarn e2e`, whose
 * Playwright `webServer` starts each app with its own `yarn build && node
 * dist`. The second build re-produces an artifact that is already there and
 * has not changed, at ~12s per app per run.
 *
 * ⚠️ The obvious check - "does dist exist" - is worse than doing nothing.
 * Existence is not freshness: an app's bundle inlines its workspace
 * dependencies (lore's `dist/index.js` is ~109KB with an empty `dependencies`
 * map, the whole framework compiled in), so editing `packages/alepha/src`
 * leaves a present, stale, wrong bundle. A suite then passes against the
 * previous build and reports nothing. This compares mtimes instead, and the
 * clean/rebuild ordering elsewhere in the pipeline exists for the same reason.
 *
 * ⚠️ Nor can it be answered from the bundler's own output. Sourcemaps list
 * every input the server bundle consumed, but the client build emits no
 * sourcemaps at all, so a map-driven check silently ignores every
 * browser-only module. The inputs are derived from the dependency graph
 * instead, which covers both halves.
 */
export class BuildFreshness {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Directories under an app that end up inside `dist`, beyond its code.
   *
   * `public` and `migrations` are copied into the build, so a changed asset
   * or a new migration invalidates it exactly as a `.tsx` does.
   */
  static readonly APP_INPUTS = ["src", "public", "migrations", "package.json"];

  /**
   * Why `dist` is stale, or null when it is current.
   *
   * A string rather than a boolean so the command can say what changed:
   * "skipping build" with no reason is indistinguishable from a broken check.
   */
  async staleReason(root: string, distDir: string): Promise<string | null> {
    const artifact = this.fs.join(root, distDir, "index.js");
    if (!(await this.fs.exists(artifact))) {
      return `${distDir}/index.js is missing`;
    }
    const builtAt = (await this.fs.stat(artifact)).mtimeMs;

    const inputs = await this.inputRoots(root);
    // No readable input at all is not "nothing changed", it is "this check
    // cannot see the sources". Answering fresh there would skip the build on
    // the strength of having found nothing, which is the one answer this
    // class must never give.
    if (inputs.length === 0) {
      return `no readable sources under ${root}`;
    }

    for (const dir of inputs) {
      if ((await this.newestUnder(dir)) > builtAt) {
        return `${dir} changed since the last build`;
      }
    }
    return null;
  }

  /**
   * Every path whose contents the build is derived from: the app's own
   * inputs, then the same inputs of each workspace dependency it bundles.
   *
   * Derived from `package.json` rather than configured, so adding a workspace
   * dependency cannot leave this check answering "fresh" for a build that is
   * not. A hand-maintained list was the alternative and it rots silently -
   * the failure it produces is a green suite testing the previous bundle.
   */
  protected async inputRoots(root: string): Promise<string[]> {
    const roots: string[] = [];
    const seen = new Set<string>();
    const queue = [root];

    while (queue.length > 0) {
      const dir = queue.shift()!;
      if (seen.has(dir)) continue;
      seen.add(dir);

      for (const input of BuildFreshness.APP_INPUTS) {
        const path = this.fs.join(dir, input);
        if (await this.fs.exists(path)) {
          roots.push(path);
        }
      }

      // Only `workspace:` dependencies are followed. A published package is
      // pinned by version and reinstalled rather than edited, and walking
      // node_modules for one would cost far more than the build it guards.
      for (const name of await this.workspaceDeps(dir)) {
        const resolved = await this.resolveDep(dir, name);
        if (resolved) {
          queue.push(resolved);
        }
      }
    }
    return roots;
  }

  /**
   * Locate a dependency's directory, walking up the way Node resolution does.
   *
   * ⚠️ Load-bearing, and the app's own `node_modules` is the WRONG place to
   * look. Yarn hoists workspace symlinks to the repo root, so
   * `apps/<app>/node_modules/<pkg>` does not exist while
   * `<repo>/node_modules/<pkg>` is a symlink into `packages/`. Resolving only
   * against the app silently found nothing, and since the app's own `src` was
   * still readable the check then reported a fresh build while the whole
   * framework had changed underneath it - the precise false "fresh" this
   * class exists to prevent.
   */
  protected async resolveDep(
    fromDir: string,
    name: string,
  ): Promise<string | null> {
    let dir = fromDir;
    // A parent that no longer changes the resolved path is the filesystem
    // root, which is the only reliable stop condition across platforms.
    for (let guard = 0; guard < 64; guard++) {
      const candidate = this.fs.join(dir, "node_modules", name);
      if (await this.fs.exists(this.fs.join(candidate, "package.json"))) {
        return candidate;
      }
      const parent = this.fs.resolve(dir, "..");
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
    return null;
  }

  /**
   * The `workspace:`-protocol dependency names declared by one package.
   */
  protected async workspaceDeps(dir: string): Promise<string[]> {
    const manifest = this.fs.join(dir, "package.json");
    if (!(await this.fs.exists(manifest))) {
      return [];
    }
    let pkg: { dependencies?: Record<string, string> };
    try {
      pkg = await this.fs.readJsonFile(manifest);
    } catch {
      return [];
    }
    return Object.entries(pkg.dependencies ?? {})
      .filter(([, range]) => range.startsWith("workspace:"))
      .map(([name]) => name);
  }

  /**
   * The newest mtime at or under `path`.
   *
   * Returns Infinity when the path cannot be read: "cannot prove this is
   * fresh" has to mean rebuild, never skip. Every failure mode in this class
   * errs toward doing the build.
   */
  protected async newestUnder(path: string): Promise<number> {
    try {
      const entry = await this.fs.stat(path);
      if (!entry.isDirectory) {
        return entry.mtimeMs;
      }
      let newest = entry.mtimeMs;
      for (const child of await this.fs.ls(path, { recursive: true })) {
        const at = await this.fs.stat(this.fs.join(path, child));
        if (at.mtimeMs > newest) {
          newest = at.mtimeMs;
        }
      }
      return newest;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
}
