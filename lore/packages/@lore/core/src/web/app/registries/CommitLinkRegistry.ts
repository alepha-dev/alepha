/**
 * Where a commit's short sha links (#Q4136, review #130 item 3): a commit
 * shows on a quest's rail (Plan) and on Ship's artifacts, and only Build
 * knows the project's repositories, so the link is a hook Build registers
 * here and `CommitLink` calls.
 *
 * The hook answers an in-app path, or undefined for plain text: Lore links
 * commits only into its own repositories, never to an external forge.
 *
 * ⚠️ A hook: it is called during `CommitLink`'s render, the same one every
 * render, so it may itself call hooks (a store, a query).
 */
export class CommitLinkRegistry {
  protected hook?: CommitHrefHook;

  public register(hook: CommitHrefHook): void {
    this.hook = hook;
  }

  /**
   * The registered hook, or one that links nothing.
   */
  public get useHref(): CommitHrefHook {
    return this.hook ?? CommitLinkRegistry.none;
  }

  protected static none: CommitHrefHook = () => undefined;
}

/**
 * `sha` the full sha, `repo` the free text a trail recorded beside it
 * (`<project>/<repo>`, `<repo>`, or another forge's `owner/name`).
 */
export type CommitHrefHook = (
  sha: string,
  repo?: string,
) => `/${string}` | undefined;
