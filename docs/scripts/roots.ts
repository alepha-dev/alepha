import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Where each product's documentation is read from.
 *
 * The site lives in `docs/`, beside the three products it documents
 * (`framework/`, `lore/`, `bay/`), and each section follows how its product
 * ships (#Q2766): the framework's pages describe the npm release, Bay's the
 * released binary, Lore's the hosted `main`. A deploy materialises the
 * framework (and later Bay) at its release tag and names that checkout in
 * `DOCS_FRAMEWORK_ROOT` / `DOCS_BAY_ROOT`; without them every section reads
 * the working tree, which is what `yarn dev` and the checks want.
 *
 * Only `gen:tree` follows the pins. `gen:docs` and `check:docs` work on the
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
   * The framework as published: the pinned checkout when a deploy names one.
   */
  public static frameworkPublished(): string {
    const pinned = DocsRoots.pinned("DOCS_FRAMEWORK_ROOT");
    if (!pinned) {
      return DocsRoots.framework;
    }
    // A tag cut before the repository took its three folders (#Q2765) has
    // the framework at its root; any later one under `framework/`.
    const nested = join(pinned, "framework");
    return existsSync(join(nested, "docs")) ? nested : pinned;
  }

  /**
   * Bay as published: the pinned checkout when a deploy names one.
   */
  public static bayPublished(): string {
    return DocsRoots.pinned("DOCS_BAY_ROOT") ?? join(DocsRoots.repo, "bay");
  }

  /**
   * Lore is hosted and deploys from `main`, so its pages are never pinned.
   */
  public static lorePublished(): string {
    return join(DocsRoots.repo, "lore");
  }

  protected static pinned(name: string): string | undefined {
    const value = process.env[name];
    return value ? resolve(DocsRoots.repo, value) : undefined;
  }
}
