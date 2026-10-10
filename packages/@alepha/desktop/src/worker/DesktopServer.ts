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
   *
   * ⚠️ **127.0.0.1 on an ephemeral port, or nothing.** The shell sets
   * `SERVER_HOST` and `SERVER_PORT` for that, but an app can still override
   * them in its own configuration. Silently rebinding would hide the conflict
   * and silently accepting would expose the app to the network, so an app
   * asking for anything else fails to start with the reason.
   */
  protected serveOptions(options: any): any {
    if (options?.unix) {
      throw new AlephaError(
        "A desktop app listens on 127.0.0.1, not on a unix socket. Remove the socket from the app's server configuration.",
      );
    }
    const hostname = String(options?.hostname ?? "");
    const port = Number(options?.port ?? -1);
    if (hostname !== "127.0.0.1" || port !== 0) {
      throw new AlephaError(
        `A desktop app listens on 127.0.0.1 on a random port, and this app asked for ${hostname || "(no host)"}:${options?.port ?? "(no port)"}. ` +
          "Remove SERVER_HOST and SERVER_PORT from the app's own configuration: the desktop shell sets them.",
      );
    }
    return options;
  }
}
