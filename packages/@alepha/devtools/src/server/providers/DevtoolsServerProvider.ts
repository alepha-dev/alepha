import type { IncomingMessage } from "node:http";

import { $inject, z } from "alepha";
import {
  InspectorClient,
  InspectorRegistry,
  inspectorRunSchema,
} from "alepha/inspector";
import { $logger } from "alepha/logger";
import {
  $route,
  type ServerRequest,
  ServerRouterProvider,
} from "alepha/server";

/**
 * The devtools server: the list of runs, and a proxy from the browser to
 * each run's inspector socket.
 *
 * The UI calls `/apps/:runId/api/<path>`, which is forwarded to `<path>` on
 * that run's socket. The run id in the URL is what keeps a panel bookmarkable
 * and lets two tabs inspect two apps.
 *
 * Only the method, the path, the query and a JSON body cross the proxy. No
 * header is forwarded, cookies least of all: the socket's routes need no
 * credential, and an app's session has no business leaving the browser for
 * another process.
 */
export class DevtoolsServerProvider {
  protected readonly log = $logger();
  protected readonly client = $inject(InspectorClient);
  protected readonly registry = $inject(InspectorRegistry);
  protected readonly serverRouter = $inject(ServerRouterProvider);

  /**
   * Request bodies are JSON edits from the UI.
   */
  protected readonly maxBodyBytes = 1024 * 1024;

  /**
   * Every run the UI can switch to: live ones, then the last dead run of each
   * app while its logs remain. The UI polls it to follow apps as they start,
   * stop, and restart.
   */
  protected readonly runsRoute = $route({
    method: "GET",
    path: "/runs",
    silent: true,
    schema: {
      response: z.object({ runs: z.array(inspectorRunSchema) }),
    },
    handler: async () => ({ runs: await this.client.discover() }),
  });

  /**
   * One raw route per method rather than a `$route`: the proxy forwards
   * whatever the run answers, status included, without a schema of its own.
   */
  protected readonly proxyRoutes = this.mountProxy();

  protected mountProxy(): number {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
    for (const method of methods) {
      this.serverRouter.createRoute({
        method,
        path: "/apps/:runId/api/*",
        silent: true,
        handler: (request: ServerRequest) => this.proxy(request),
      });
      this.serverRouter.createRoute({
        method,
        path: "/apps/:runId/http/*",
        silent: true,
        handler: (request: ServerRequest) => this.proxyHttp(request),
      });
    }
    return methods.length;
  }

  /**
   * The HTTP port of each run, read once from its metadata.
   */
  protected readonly ports = new Map<string, number>();

  /**
   * The actions panel's Try It: forwarded to the run's OWN HTTP server, the
   * one its users reach, on loopback. `localhost` rather than `127.0.0.1`:
   * Vite's dev server listens on `::1` alone, and fetch tries both families. The port comes from the run itself,
   * never from the request, so this cannot be pointed at another service.
   * Only the method, path, query, a JSON body and its content type cross;
   * no cookie, so the call runs unauthenticated.
   */
  protected async proxyHttp(request: ServerRequest): Promise<void> {
    const params = request.params as Record<string, string>;
    const run = await this.registry.get(params.runId ?? "");
    if (!run || run.status !== "live") {
      this.reply(request, run ? 410 : 404, {
        message: run
          ? `Run "${run.name}" is not running`
          : `No run ${params.runId}`,
      });
      return;
    }

    let port = this.ports.get(run.runId);
    if (!port) {
      try {
        port = (await this.client.connect(run).call("metadata")).system.port;
        this.ports.set(run.runId, port);
      } catch (error) {
        this.reply(request, 502, {
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    const body = await this.readBody(request);
    if (body && "status" in body) {
      this.reply(request, body.status, { message: body.message });
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:${port}/${params["*"] ?? ""}${request.url.search}`,
        {
          method: request.method,
          headers:
            body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body.value),
        },
      );
      request.reply.status = response.status;
      request.reply.headers = {
        "content-type":
          response.headers.get("content-type") ?? "application/octet-stream",
      };
      request.reply.body = await response.text();
    } catch (error) {
      this.reply(request, 502, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  protected async proxy(request: ServerRequest): Promise<void> {
    const params = request.params as Record<string, string>;
    const path = `/${params["*"] ?? ""}${request.url.search}`;

    const run = await this.registry.get(params.runId ?? "");
    if (!run) {
      this.reply(request, 404, { message: `No run ${params.runId}` });
      return;
    }

    let connection: ReturnType<InspectorClient["connect"]>;
    try {
      connection = this.client.connect(run);
    } catch (error) {
      // Another protocol version: the message names the release to use.
      this.reply(request, 409, {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // A dead run has no socket, but its logs are still on disk: the log
    // panel keeps working on a crashed app.
    if (run.status === "dead") {
      if (request.method === "GET" && params["*"] === "logs") {
        const query = Object.fromEntries(request.url.searchParams);
        this.reply(request, 200, await connection.logs(query as any));
        return;
      }
      this.reply(request, 410, {
        message: `Run "${run.name}" is not running: only its logs are readable`,
      });
      return;
    }

    const body = await this.readBody(request);
    if (body && "status" in body) {
      this.reply(request, body.status, { message: body.message });
      return;
    }

    try {
      const response = await connection.request(
        request.method,
        path,
        body?.value,
      );
      this.reply(request, response.status, response.body);
    } catch (error) {
      const gone = connection.isGone(error);
      this.reply(request, gone ? 410 : 502, {
        message: gone
          ? `Run "${run.name}" stopped`
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  /**
   * The JSON body, `undefined` when there is none, or the status refusing it.
   */
  protected async readBody(
    request: ServerRequest,
  ): Promise<
    { value: unknown } | { status: number; message: string } | undefined
  > {
    if (request.method === "GET") {
      return undefined;
    }

    const req = request.raw?.node?.req as IncomingMessage | undefined;
    if (!req) return undefined;

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > this.maxBodyBytes) {
        return { status: 413, message: "Request body too large" };
      }
      chunks.push(chunk as Buffer);
    }
    if (size === 0) return undefined;

    try {
      return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { status: 400, message: "Request body is not JSON" };
    }
  }

  protected reply(request: ServerRequest, status: number, body: unknown): void {
    request.reply.status = status;
    request.reply.headers = { "content-type": "application/json" };
    request.reply.body = body === undefined ? "" : JSON.stringify(body);
  }
}
