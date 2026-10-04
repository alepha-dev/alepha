import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";
import { ServerProvider } from "alepha/server";

/**
 * Refuses any request a browser was tricked into sending.
 *
 * The devtools proxies every app's inspector onto plain HTTP on loopback,
 * unauthenticated: database writes, atom writes, job triggers and the
 * environment, secrets included. Binding to `127.0.0.1` keeps the network
 * out, but not a web page the developer has open:
 *
 * - **DNS rebinding**: a page on `evil.example` points its own name at
 *   `127.0.0.1` and reads `/apps/<runId>/api/metadata` "same-origin". Its
 *   requests carry `Host: evil.example`, so only loopback names on this
 *   server's port are accepted.
 * - **Cross-site writes**: any page can send a `DELETE` here with
 *   `mode: "no-cors"`; it cannot read the answer, but the row is gone. Such a
 *   request carries the page's `Origin`, so an `Origin` that is not this
 *   server's is refused. A request without one (curl, a script) passes: no
 *   browser is being abused.
 *
 * And no `Access-Control-Allow-*` header is ever sent, so no other origin can
 * read a response either. No launch token: with these checks a browser can
 * neither read nor write cross-origin, and a token would cost bookmarkable
 * URLs. Revisit if the server ever binds beyond loopback.
 */
export class DevtoolsGuardProvider {
  protected readonly log = $logger();
  protected readonly server = $inject(ServerProvider);

  /**
   * The names this server answers to: loopback, on its own port.
   */
  public allowedHosts(): string[] {
    const port = this.port();
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  }

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    priority: "first",
    handler: ({ request }) => {
      const hosts = this.allowedHosts();
      const host = String(request.headers.host ?? "").toLowerCase();

      if (!hosts.includes(host)) {
        this.refuse(request, 421, `Host "${host}" is not this devtools`);
        return;
      }

      const origin = request.headers.origin;
      if (
        origin !== undefined &&
        !hosts.some((allowed) => origin.toLowerCase() === `http://${allowed}`)
      ) {
        this.refuse(request, 403, `Origin "${origin}" is not this devtools`);
      }
    },
  });

  protected refuse(
    request: {
      reply: { status?: number; headers: Record<string, any>; body?: any };
    },
    status: number,
    message: string,
  ): void {
    this.log.warn("Refused a request", { status, message });
    request.reply.status = status;
    request.reply.headers = { "content-type": "application/json" };
    request.reply.body = JSON.stringify({ message });
  }

  /**
   * The port actually bound, which `--port 0` or a CLI-picked port never
   * matches in the environment.
   */
  protected port(): string {
    try {
      return new URL(this.server.hostname).port;
    } catch {
      return "";
    }
  }
}
