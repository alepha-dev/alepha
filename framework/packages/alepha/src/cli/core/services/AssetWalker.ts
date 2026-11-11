import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * Which files of a build are its assets, decided in one place.
 *
 * ## ⚠️ Three readers, one answer
 *
 * `alepha pack` writes the archive with `tar --exclude` over
 * {@link EXCLUDES}; a laptop Cloudflare deploy walks `dist/public` itself
 * (`WorkerCloudflareAdapter`); Lore's CLI builds the asset list it pushes
 * beside the archive from the same directory. Until #Q3378 the laptop deploy
 * walked with no exclusion at all, so it uploaded `*.map` files and a stray
 * `.DS_Store` that a Lore deploy of the same build never had. The two deploys
 * then disagreed on what the site serves, silently.
 *
 * So the list lives here, `WorkspacePacker` hands it to `tar`, and every JS
 * walk goes through {@link walk}.
 *
 * ## The matching rule is tar's
 *
 * A pattern without a slash matches any one path segment, at any depth, the
 * way `tar --exclude` reads it in GNU and BSD tar alike: `e2e` drops a
 * directory named `e2e` wherever it is, and `*.map` drops every source map.
 * `*` is the only wildcard any entry uses, so it is the only one supported.
 */
export class AssetWalker {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Paths that slip into `dist/` and must not reach an artifact or a deploy.
   *
   * ⚠️ **`*.map` is here, so this changes what EVERY `alepha pack` produces**,
   * and every laptop deploy: no runtime reads a source map out of a tarball,
   * and Cloudflare treats them as a separate opt-in (`upload_source_maps`).
   * `WorkspacePacker` writes them to a sibling maps archive instead, so they
   * are routed, not discarded. Adding a pattern here without a route for what
   * it removes is how a diagnostic quietly stops existing.
   */
  public static readonly EXCLUDES: readonly string[] = [
    "node_modules",
    ".DS_Store",
    "._*",
    ".alepha",
    "e2e",
    "playwright-report",
    "test-results",
    "coverage",
    "*.map",
  ];

  protected readonly patterns = AssetWalker.EXCLUDES.map(
    (pattern) =>
      new RegExp(
        `^${pattern
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*")}$`,
      ),
  );

  /**
   * Whether a path, relative to the walked root, is left out.
   *
   * Excluded when any of its segments matches, so a file under an excluded
   * directory is excluded with it.
   */
  public isExcluded(relativePath: string): boolean {
    return relativePath
      .replace(/\\/g, "/")
      .split("/")
      .some(
        (segment) =>
          segment !== "" &&
          this.patterns.some((pattern) => pattern.test(segment)),
      );
  }

  /**
   * Every file under `root`, relative to it with `/` separators, sorted, with
   * {@link EXCLUDES} left out. Directories are not listed.
   *
   * An absent `root` answers an empty list: a build with no `public/` has no
   * assets, which is not an error.
   */
  public async walk(root: string): Promise<string[]> {
    if (!(await this.fs.exists(root))) {
      return [];
    }
    const files: string[] = [];
    for (const entry of await this.fs.ls(root, { recursive: true })) {
      const relative = entry.replace(/\\/g, "/");
      if (this.isExcluded(relative)) {
        continue;
      }
      // ⚠️ A recursive listing names directories too on the node provider,
      // and reading one is an error rather than an empty file.
      if (!(await this.fs.stat(this.fs.join(root, entry))).isFile) {
        continue;
      }
      files.push(relative);
    }
    return files.sort();
  }
}
