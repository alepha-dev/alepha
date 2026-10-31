/**
 * What a browser does with Set-Cookie: it drops a cookie past 4096 bytes of
 * name and value without a word, which is the whole reason for chunking, and
 * expires one on `Max-Age=0`.
 */
export class BrowserJar {
  public readonly cookies = new Map<string, string>();

  public apply(setCookie: string[]): void {
    for (const header of setCookie) {
      const [pair, ...attributes] = header.split("; ");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      if (attributes.includes("Max-Age=0")) {
        this.cookies.delete(name);
      } else if (pair.length - 1 <= 4096) {
        this.cookies.set(name, pair.slice(separator + 1));
      }
    }
  }

  public get names(): string[] {
    return [...this.cookies.keys()].sort();
  }

  public get header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
