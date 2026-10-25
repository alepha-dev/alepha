import { $inject, Alepha } from "alepha";

/**
 * Where a request carrying an ambient credential (the session cookie) may
 * come from.
 *
 * One rule shared by every place that turns the cookie into a bearer token:
 * the HTTP pipeline (`ServerAuthProvider`), the WebSocket upgrade
 * (`WebSocketServerProvider`) and the OAuth consent and device approval
 * posts (`OAuthController`). A cookie is attached by the browser whatever
 * page sent the request, so a request from another site, or from a sibling
 * subdomain that `SameSite=Lax` lets through, must not act as the user.
 *
 * Hosts are compared, not whole origins, so a proxy that terminates TLS
 * without forwarding the scheme cannot refuse every legitimate request.
 *
 * "Listed in CORS" means the global CORS `origin` names it explicitly. The
 * default `"*"` lists nothing: it protects nothing, so it trusts nothing.
 */
export class RequestOriginPolicy {
  protected readonly alepha = $inject(Alepha);

  /**
   * Methods that change nothing, so a cross-site one is how every link into
   * the app arrives. They keep the cookie whatever their origin.
   */
  public static readonly SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

  /**
   * The host of a URL or origin, or `undefined` when there is none to trust:
   * absent, unparsable, or the opaque `Origin: null` (a sandboxed frame, a
   * privacy-sensitive redirect).
   */
  public hostOf(source: string | undefined): string | undefined {
    if (!source || source === "null") {
      return undefined;
    }
    try {
      return new URL(source).host.toLowerCase() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Whether `source` (an `Origin` or a `Referer`) names `host`.
   */
  public isSameHost(source: string | undefined, host: string): boolean {
    const sourceHost = this.hostOf(source);
    return sourceHost !== undefined && sourceHost === host.toLowerCase();
  }

  /**
   * The origins the global CORS configuration lists explicitly. Read from
   * the store, not from `alepha/server/cors`, which depends on this module:
   * an app without the CORS module lists nothing.
   */
  public listedOrigins(): string[] {
    const options = this.alepha.store.get(
      "alepha.server.cors.options" as any,
    ) as { origin?: string } | undefined;
    const origin = options?.origin;
    if (!origin || origin === "*") {
      return [];
    }
    return origin
      .split(",")
      .map((it) => it.trim())
      .filter((it) => it !== "" && it !== "*");
  }

  /**
   * Whether `origin` is listed explicitly in the CORS configuration.
   */
  public isListedOrigin(origin: string | undefined): boolean {
    if (!origin || origin === "null") {
      return false;
    }
    const normalized = origin.replace(/\/+$/, "").toLowerCase();
    return this.listedOrigins().some(
      (it) => it.replace(/\/+$/, "").toLowerCase() === normalized,
    );
  }

  /**
   * Whether `origin` is this host, or an origin the CORS configuration lists
   * explicitly. A missing or opaque origin is neither.
   */
  public isTrustedOrigin(origin: string | undefined, host: string): boolean {
    return this.isSameHost(origin, host) || this.isListedOrigin(origin);
  }

  /**
   * Whether a POST came from a page on this host: `Origin`, else `Referer`.
   * A request naming neither is refused rather than trusted, since every
   * browser sends `Origin` on a form post. For endpoints that only this
   * host's own pages post to (OAuth consent, device approval).
   */
  public isSameHostRequest(
    headers: Record<string, string | undefined>,
    host: string,
  ): boolean {
    return this.isSameHost(headers.origin ?? headers.referer, host);
  }

  /**
   * Whether the session cookie of an HTTP request may stand for the user.
   *
   * - A safe method (GET, HEAD, OPTIONS) always may.
   * - `Sec-Fetch-Site: same-origin` or `none` (typed in the address bar) may.
   *   Any other value (`same-site` is the sibling-subdomain hole, `cross-site`
   *   another site) may only when its `Origin` is listed explicitly in CORS.
   * - Without `Sec-Fetch-Site`, an `Origin` must be this host or listed in
   *   CORS.
   * - With neither header the request is not from a browser, which sends at
   *   least one of them on every cross-site write, so the cookie stands as
   *   it always has.
   *
   * A refusal leaves the request anonymous: `$secure` answers 401.
   */
  public allowsCookieCredentials(request: {
    method: string;
    headers: Record<string, string | undefined>;
    url: URL;
  }): boolean {
    if (
      RequestOriginPolicy.SAFE_METHODS.includes(request.method.toUpperCase())
    ) {
      return true;
    }

    const site = request.headers["sec-fetch-site"]?.toLowerCase();
    const origin = request.headers.origin;
    if (site !== undefined) {
      if (site === "same-origin" || site === "none") {
        return true;
      }
      return this.isListedOrigin(origin);
    }

    if (origin !== undefined) {
      return this.isTrustedOrigin(origin, request.url.host);
    }

    return true;
  }
}
