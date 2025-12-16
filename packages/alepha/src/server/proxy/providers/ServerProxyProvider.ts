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
    const target =
      typeof options.target === "function" ? options.target() : options.target;

    if (!path.endsWith("/*")) {
      throw new AlephaError("Proxy path should end with '/*'");
    }

    // Extract base path without /*
    const handler = this.createProxyHandler(target, options);

    for (const method of routeMethods) {
      this.routerProvider.createRoute({
        method,
        path,
        handler,
      });
    }

    this.log.info("Proxying", { path, target });
  }

  public createProxyHandler(
    target: string,
    options: Omit<ProxyPrimitiveOptions, "path">,
  ): ServerHandler {
    return async (request) => {
      const url = new URL(target + request.url.pathname);
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

      const response = await fetch(requestInit.url, requestInit);

      request.reply.status = response.status;
      request.reply.headers = Object.fromEntries(response.headers.entries());
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

  private getRawRequestBody(req: ServerRequest): ReadableStream | undefined {
    const { method } = req;

    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return;
    }

    if (req.raw?.web?.req) {
      return req.raw.web.req.body as ReadableStream;
    }

    if (req.raw?.node?.req) {
      const nodeReq = req.raw.node.req;
      return WebStream.from(nodeReq) as ReadableStream;
    }
  }
}
