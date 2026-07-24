import type { Cookie } from "../primitives/$cookie.ts";

export class CookieParser {
  public parseRequestCookies(header: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    const parts = header.split(";");
    for (const part of parts) {
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }

      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();

      if (!key || !value) {
        continue;
      }

      cookies[key] = value;
    }

    return cookies;
  }

  public serializeResponseCookies(
    cookies: Record<string, Cookie | null>,
    isHttps: boolean,
  ): string[] {
    const headers = [];

    for (const [name, cookie] of Object.entries(cookies)) {
      // If the cookie is null, we need to delete it
      if (cookie == null) {
        headers.push(`${name}=; Path=/; Max-Age=0`);
        continue;
      }

      // `Max-Age=0` is an explicit deletion and legitimately carries an empty
      // value — dropping it here is what made a scoped cookie undeletable.
      if (!cookie.value && cookie.maxAge !== 0) {
        continue;
      }

      headers.push(this.cookieToString(name, cookie, isHttps));
    }

    return headers;
  }

  public cookieToString(
    name: string,
    cookie: Cookie,
    isHttps?: boolean,
  ): string {
    const parts: string[] = [];

    parts.push(`${name}=${cookie.value}`);

    if (cookie.path) {
      parts.push(`Path=${cookie.path}`);
    }
    // `!= null`, not truthy: `maxAge: 0` is the standard "delete this
    // cookie now" value (used by AtomCookiePersistence.browser.ts's
    // clearCookie() and BrowserCookiePrimitive.del()). A truthy check would
    // silently drop `Max-Age` for exactly that value, turning a deletion
    // into a plain (non-expiring-until-session-end) write.
    if (cookie.maxAge != null) {
      parts.push(`Max-Age=${cookie.maxAge}`);
    }
    if (cookie.secure !== false && isHttps) {
      parts.push("Secure");
    }
    if (cookie.httpOnly) {
      parts.push("HttpOnly");
    }
    if (cookie.sameSite) {
      parts.push(`SameSite=${cookie.sameSite}`);
    }
    if (cookie.domain) {
      parts.push(`Domain=${cookie.domain}`);
    }

    return parts.join("; ");
  }
}
