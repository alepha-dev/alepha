import { timingSafeEqual } from "node:crypto";

/**
 * The gate in front of a desktop app's HTTP server: only the app's own window
 * gets in.
 *
 * Every request crosses {@link admit} before the app sees it (before
 * routing, before the app's request logging, before a WebSocket upgrade), so
 * static files, actions, unknown paths and `OPTIONS` all need the same
 * credential:
 *
 * 1. `Host` must be exactly `127.0.0.1:<port>`; forwarded headers are never
 *    read.
 * 2. `GET /__alepha_desktop/bootstrap?capability=<64 hex>` is answered here:
 *    the launch capability the shell put in the window's first URL works
 *    once, within {@link bootstrapTtlMs} of launch, and is exchanged for an
 *    independent random session in a host-only `HttpOnly; SameSite=Strict;
 *    Path=/` cookie, with a `303` to `/`. The capability is never the cookie,
 *    never logged, and the reply is `no-store` with no referrer.
 * 3. A supplied `Origin` must be exactly the server's origin (`null`
 *    included is refused), and `Sec-Fetch-Site` must be `same-origin` or
 *    `none`: cookies and `SameSite` do not isolate ports, so a page on
 *    another loopback port holding a valid cookie is still turned away.
 * 4. Every other request carries the session cookie.
 *
 * Anything else is a bare `403`. The session is per launch: a cookie from a
 * previous launch, or another app, opens nothing.
 *
 * Threat model: unsolicited requests from browsers and local processes. Code
 * already running as the same OS user can read the process and is out of
 * scope.
 */
export class DesktopAdmission {
  /**
   * The bootstrap path the shell loads first.
   */
  public readonly bootstrapPath = "/__alepha_desktop/bootstrap";

  /**
   * How long after launch the capability is accepted.
   */
  public readonly bootstrapTtlMs = 30_000;

  /**
   * The session cookie's name, specific to the app's identifier.
   */
  public readonly cookieName: string;

  protected readonly capability: Buffer;
  protected readonly issuedAt: number;
  protected readonly now: () => number;
  protected readonly session: string;
  protected used = false;

  constructor(options: {
    capability: string;
    identifier: string;
    now?: () => number;
  }) {
    this.capability = Buffer.from(options.capability);
    this.now = options.now ?? (() => performance.now());
    this.issuedAt = this.now();
    this.cookieName = `alepha_desktop_${options.identifier.replace(/[^A-Za-z0-9]/g, "_")}`;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    this.session = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  /**
   * A response that ends the request here, or undefined to let the app have
   * it.
   */
  public admit(request: Request, port: number): Response | undefined {
    const host = `127.0.0.1:${port}`;
    if (request.headers.get("host") !== host) {
      return this.forbidden();
    }

    const url = new URL(request.url);
    if (url.pathname === this.bootstrapPath) {
      return this.bootstrap(request, url);
    }

    const origin = request.headers.get("origin");
    if (origin !== null && origin !== `http://${host}`) {
      return this.forbidden();
    }
    const site = request.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin" && site !== "none") {
      return this.forbidden();
    }
    if (!this.hasSession(request.headers.get("cookie"))) {
      return this.forbidden();
    }
    return undefined;
  }

  protected bootstrap(request: Request, url: URL): Response {
    const given = Buffer.from(url.searchParams.get("capability") ?? "");
    const valid =
      request.method === "GET" &&
      !this.used &&
      this.now() - this.issuedAt <= this.bootstrapTtlMs &&
      given.length === this.capability.length &&
      timingSafeEqual(given, this.capability);
    if (!valid) {
      return this.forbidden();
    }
    // Synchronous from the check to here: two concurrent bootstraps cannot
    // both pass.
    this.used = true;
    return new Response(null, {
      status: 303,
      headers: {
        location: "/",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "set-cookie": `${this.cookieName}=${this.session}; HttpOnly; SameSite=Strict; Path=/`,
      },
    });
  }

  protected hasSession(header: string | null): boolean {
    if (!header) {
      return false;
    }
    const expected = Buffer.from(this.session);
    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index === -1 || part.slice(0, index).trim() !== this.cookieName) {
        continue;
      }
      const value = Buffer.from(part.slice(index + 1).trim());
      if (
        value.length === expected.length &&
        timingSafeEqual(value, expected)
      ) {
        return true;
      }
    }
    return false;
  }

  protected forbidden(): Response {
    return new Response("Forbidden", {
      status: 403,
      headers: {
        "content-type": "text/plain",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }
}
