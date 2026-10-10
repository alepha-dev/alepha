import { AlephaError } from "alepha";

/**
 * The app's HTTP server, as seen from the desktop Worker.
 *
 * The Worker cannot inject the app's `ServerProvider`: the app bundle carries
 * its own copy of `alepha`, and a class token from this package's copy names
 * a different class. What both copies share is `Bun.serve`, so this wraps it
 * before the app is imported and records the server the app starts. That is
 * also the one boundary every request crosses before routing and logging,
 * which is where the desktop constraints belong.
 */
export class DesktopServer {
  protected server?: { hostname?: string; port?: number };
  protected original?: typeof Bun.serve;

  /**
   * Wrap `Bun.serve`. Idempotent; {@link uninstall} restores it.
   */
  public install(bun: { serve: typeof Bun.serve } = Bun): void {
    if (this.original) {
      return;
    }
    const original = bun.serve;
    this.original = original;
    bun.serve = ((options: any) => {
      if (this.server) {
        throw new AlephaError(
          "A desktop app serves exactly one HTTP server; a second Bun.serve was refused.",
        );
      }
      const server = original.call(bun, this.serveOptions(options));
      this.server = server;
      return server;
    }) as typeof Bun.serve;
  }

  /**
   * Restore the original `Bun.serve`.
   */
  public uninstall(bun: { serve: typeof Bun.serve } = Bun): void {
    if (this.original) {
      bun.serve = this.original;
      this.original = undefined;
    }
  }

  /**
   * The bound origin, `http://127.0.0.1:<port>`, once the app listens.
   */
  public origin(): string | undefined {
    if (!this.server?.port) {
      return undefined;
    }
    return `http://${this.server.hostname}:${this.server.port}`;
  }

  /**
   * The options the app's server actually starts with.
   */
  protected serveOptions(options: any): any {
    return options;
  }
}
