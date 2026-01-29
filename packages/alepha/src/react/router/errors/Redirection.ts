import { AlephaError } from "alepha";

/**
 * Used for Redirection during the page loading.
 *
 * Depends on the context, it can be thrown or just returned.
 *
 * @example
 * ```ts
 * import { Redirection } from "alepha/react";
 *
 * const MyPage = $page({
 *   loader: async () => {
 *    if (needRedirect) {
 *      throw new Redirection("/new-path");
 *    }
 *   },
 * });
 * ```
 */
export class Redirection extends AlephaError {
  public readonly redirect: string;

  constructor(redirect: string) {
    super("Redirection");
    this.redirect = redirect;
  }
}
