import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Where each product's documentation is read from.
 *
 * The site lives in `docs/`, beside the three products it documents
 * (`framework/`, `lore/`, `bay/`), and each section follows how its product
 * ships (#Q2766): the framework's and Bay's pages describe the release (one
 * version and one tag for both, #Q2776), Lore's the hosted `main`. A deploy
 * checks the latest release tag out (`yarn pin`) and names that checkout in
 * `DOCS_RELEASE_ROOT`; without it every section reads the working tree, which
 * is what `yarn dev` and the checks want.
 *
 * Only `gen:tree` follows the pin. `gen:docs` and `check:docs` work on the
 * framework working tree, always: they write and audit the pages a commit
 * carries, not the ones a deploy publishes.
 */
export class DocsRoots {
  /**
   * The repository root, one level above this app.
   */
  public static readonly repo = resolve(import.meta.dirname, "../..");

  /**
   * The framework working tree, for the generators and the checks.
   */
  public static readonly framework = join(DocsRoots.repo, "framework");

  /**
   * The framework as released: the pinned checkout when a deploy names one.
   */
  public static frameworkPublished(): string {
    const release = DocsRoots.release();
    if (!release) {
      return DocsRoots.framework;
    }
    // A tag cut before the repository took its three folders (#Q2765) has
    // the framework at its root; any later one under `framework/`.
    const nested = join(release, "framework");
    return existsSync(join(nested, "docs")) ? nested : release;
  }

  /**
   * Bay as released. A tag cut before Bay joined the shared release has no
   * `bay/docs`, and the section then reads the working tree.
   */
  public static bayPublished(): string {
    const release = DocsRoots.release();
    const pinned = release ? join(release, "bay") : undefined;
    return pinned && existsSync(join(pinned, "docs"))
      ? pinned
      : join(DocsRoots.repo, "bay");
  }

  /**
   * Lore is hosted and deploys from `main`, so its pages are never pinned.
   */
  public static lorePublished(): string {
    return join(DocsRoots.repo, "lore");
  }

  /**
   * The release checkout `DOCS_RELEASE_ROOT` names, or nothing when it is
   * unset or was never checked out.
   */
  protected static release(): string | undefined {
    const value = process.env.DOCS_RELEASE_ROOT;
    if (!value) {
      return undefined;
    }
    const dir = resolve(DocsRoots.repo, value);
    return existsSync(dir) ? dir : undefined;
  }
}
