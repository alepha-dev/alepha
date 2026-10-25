import type { Tokens } from "alepha/server/auth";

/**
 * How `ReactAuth` reaches the auth routes and holds a session.
 *
 * This default is the web's: relative URLs on the page's own origin, and a
 * session the server keeps in cookies the browser sends by itself. A native
 * app cannot use either (its WebView origin is not the API, and a cookie of
 * another origin is never sent), so `@alepha/capacitor` substitutes a
 * transport that calls the API's origin with `credentials: "omit"`, keeps the
 * tokens in secure storage and sends them as a Bearer header.
 *
 * Substitute it before `AlephaReactAuth` is registered.
 */
export class ReactAuthTransport {
  /**
   * Whether the session lives in cookies the browser sends by itself. With
   * cookies, a signed-in `$client` call asks for credentials; without, it
   * never does.
   */
  public readonly cookies: boolean = true;

  /**
   * The URL of an auth route, e.g. `/_auth/token`.
   */
  public url(path: string): string {
    return path;
  }

  /**
   * Options added to an auth request: headers and credentials.
   * `authenticated` is true for a request made as the signed-in user
   * (`userinfo`), false for one that signs in.
   */
  public async request(_opts: { authenticated: boolean }): Promise<{
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
  }> {
    return {};
  }

  /**
   * Hold the tokens of a sign-in, before the user is exposed. The server set
   * the cookies already.
   */
  public async signedIn(_tokens: Tokens): Promise<void> {}

  /**
   * Sign out without a page navigation. `false` lets `ReactAuth` post the
   * cookie logout form, which is what a website does.
   */
  public async signOut(): Promise<boolean> {
    return false;
  }
}
