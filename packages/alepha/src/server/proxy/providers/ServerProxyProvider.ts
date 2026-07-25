import { ReadableStream as WebStream } from "node:stream/web";
import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import {
  routeMethods,
  type ServerHandler,
  type ServerRequest,
  ServerRouterProvider,
} from "alepha/server";
import { $proxy, type ProxyPrimitiveOptions } from "../primitives/$proxy.ts";

export class ServerProxyProvider {
  protected readonly log = $logger();
  protected readonly routerProvider = $inject(ServerRouterProvider);
  protected readonly alepha = $inject(Alepha);

  protected readonly configure = $hook({
    on: "configure",
    handler: () => {
      for (const proxy of this.alepha.primitives($proxy)) {
        this.createProxy(proxy.options);
      }
    },
  });

  public createProxy(options: ProxyPrimitiveOptions): void {
    if (options.disabled) {
      return;
    }

    const path = options.path;

    if (!path.endsWith("/*")) {
      throw new AlephaError("Proxy path should end with '/*'");
    }

    // Extract base path without /*
    const handler = this.createProxyHandler(options.target, options);

    for (const method of routeMethods) {
      this.routerProvider.createRoute({
        method,
        path,
        handler,
      });
    }

    this.log.info("Proxying", {
      path,
      target:
        typeof options.target === "function" ? "<dynamic>" : options.target,
    });
  }

  public createProxyHandler(
    target: ProxyPrimitiveOptions["target"],
    options: Omit<ProxyPrimitiveOptions, "path">,
  ): ServerHandler {
    return async (request) => {
      // Resolved PER REQUEST. The function form is documented as runtime
      // resolution, but it used to be called exactly once during `configure`
      // and every request then used that frozen string — so a target that
      // depends on anything discovered after startup never changed.
      const resolved = typeof target === "function" ? target() : target;

      const url = new URL(resolved + request.url.pathname);
      if (request.url.search) {
        url.search = request.url.search;
      }

      options.rewrite?.(url);

      const requestInit = {
        url: url.toString(),
        method: request.method,
        headers: {
          ...request.headers,
          "accept-encoding": "identity", // ignore compression
        },
        body: this.getRawRequestBody(request),
      };

      if (requestInit.body) {
        (requestInit as any).duplex = "half";
      }

      if (options.beforeRequest) {
        await options.beforeRequest(request, requestInit);
      }

      this.log.debug("Proxying request", {
        url: url.toString(),
        method: request.method,
        headers: request.headers,
      });

      // Note: `beforeRequest` may set `requestInit.fetcher` to a Cloudflare
      // service binding — a NATIVE workerd RequestInit field that routes the
      // subrequest through that Worker (same-zone subrequests to a host
      // served by another Worker's route would bypass it and 522). Node's
      // fetch ignores the unknown field.
      const response = await fetch(requestInit.url, requestInit);

      request.reply.status = response.status;
      request.reply.headers = Object.fromEntries(response.headers.entries());
      // Header iteration yields one entry per `set-cookie`, so fromEntries
      // keeps only the last cookie — restore the full list as an array.
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        request.reply.headers["set-cookie"] = setCookies;
      }
      request.reply.body = response.body;

      this.log.debug("Received response", {
        status: request.reply.status,
        headers: request.reply.headers,
      });

      if (options.afterResponse) {
        await options.afterResponse(request, response);
      }
    };
  }

  protected getRawRequestBody(req: ServerRequest): ReadableStream | undefined {
    const { method } = req;

    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return;
    }

    if (req.raw?.web?.req) {
      return req.raw.web.req.body as ReadableStream;
    }

    if (req.raw?.node?.req) {
      const nodeReq = req.raw.node.req;
      return WebStream.from(nodeReq) as unknown as ReadableStream;
    }
  }
}
