/**
 * Used for Redirection during the page loading.
 *
 * Depends on the context, it can be thrown or just returned.
 */
export class Redirection extends Error {
  public readonly redirect: string;

  constructor(redirect: string) {
    super("Redirection");
    this.redirect = redirect;
  }
}
