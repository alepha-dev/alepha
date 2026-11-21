/**
 * A browser for one origin, enough of one to follow a sign-in: it keeps the
 * cookies each response sets and follows redirects by hand, so every hop is
 * visible.
 */
export class Browser {
  public readonly jar = new Map<string, string>();

  public cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  public async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        cookie: this.cookie(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      const expired = attributes.some((it) =>
        /^(max-age=0|expires=thu, 01 jan 1970)/i.test(it.trim()),
      );
      if (expired || value === "") {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
    return response;
  }

  /**
   * Follow redirects until a non-3xx answer, returning every location seen.
   */
  public async follow(url: string, init: RequestInit = {}) {
    const visited: string[] = [];
    let response = await this.fetch(url, init);
    while (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get("location")!, url).toString();
      visited.push(next);
      url = next;
      response = await this.fetch(next);
    }
    return { response, visited };
  }
}
