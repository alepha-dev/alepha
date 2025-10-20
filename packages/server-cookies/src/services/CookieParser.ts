import type { Cookie } from "../descriptors/$cookie.ts";

export class CookieParser {
  public parseRequestCookies(header: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    const parts = header.split(";");
    for (const part of parts) {
      const [key, value] = part.split("=");
      if (!key || !value) {
        continue;
      }

      cookies[key.trim()] = value.trim();
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

      if (!cookie.value) {
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
    if (cookie.maxAge) {
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
