import { Readable } from "node:stream";
import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { Route } from "alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
  NodeRequestEvent,
  ServerRequestData,
  WebRequestEvent,
} from "../interfaces/ServerRequest.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

/**
 * Base server provider to handle incoming requests and route them.
 *
 * This is the default implementation for serverless environments.
 *
 * ServerProvider supports both Node.js HTTP requests and Web (Fetch API) requests.
 */
export class ServerProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly router = $inject(ServerRouterProvider);

  protected readonly internalServerErrorMessage = "Internal Server Error";

  public get hostname(): string {
    return ""; // no hostname in serverless mode
  }

  /**
   * When a Node.js HTTP request is received from outside. (Vercel, AWS Lambda, etc.)
   */
  protected readonly onNodeRequest = $hook({
    on: "node:request",
    handler: (ev) => this.handleNodeRequest(ev),
  });

  /**
   * When a Web (Fetch API) request is received from outside. (Netlify, Cloudflare Workers, etc.)
   */
  protected readonly onWebRequest = $hook({
    on: "web:request",
    handler: (ev) => {
      return this.handleWebRequest(ev);
    },
  });

  /**
   * Handle Node.js HTTP request event.
   *
   * Technically, we just convert Node.js request to Web Standard Request.
   */
  public async handleNodeRequest(
    nodeRequestEvent: NodeRequestEvent,
  ): Promise<void> {
    const { req, res } = nodeRequestEvent;
    const { route, params } = this.router.match(`/${req.method}${req.url}`);

    if (this.isViteNotFound(req.url, route, params)) {
      return;
    }

    if (!route) {
      // if no route is found, return basic 404
      // note: you should not use this in production, use a custom 404 page instead by adding a route /*
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const headers = (req.headers ?? {}) as Record<string, string>;
    const proto = headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const url = new URL(`${proto}://${headers.host}${req.url}`);
    const query = Object.fromEntries(url.searchParams.entries());
    const method = (req.method?.toUpperCase() ?? "GET") as RouteMethod;

    const request: ServerRequestData = {
      method,
      url,
      headers,
      params: params ?? {},
      query,
      raw: { node: nodeRequestEvent },
    };

    const response = await route.handler(request).catch(() => {
      return {
        status: 500,
        headers: { "content-type": "text/plain" },
        body: this.internalServerErrorMessage,
      };
    });

    // empty body - just send status & headers
    if (!response.body) {
      res.writeHead(response.status, response.headers).end();
      return;
    }

    // if response.body is string or buffer
    if (typeof response.body === "string" || Buffer.isBuffer(response.body)) {
      res.writeHead(response.status, response.headers).end(response.body);
      return;
    }

    // if response.body is node stream
    if (response.body instanceof Readable) {
      res.writeHead(response.status, response.headers);
      response.body.pipe(res);
      return;
    }

    // if response.body is web stream
    if (response.body instanceof ReadableStream) {
      res.writeHead(response.status, response.headers);
      try {
        for await (const chunk of response.body) {
          res.write(chunk);
        }
      } catch (error) {
        this.log.error("Error piping proxy response stream", error);
      } finally {
        res.end();
      }
      return;
    }

    // not supported response body type

    this.log.error("Unknown response body type:", typeof response.body);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(this.internalServerErrorMessage);
  }

  /**
   * Handle Web (Fetch API) request event.
   */
  public async handleWebRequest(ev: WebRequestEvent): Promise<void> {
    const req = ev.req;
    const url = new URL(req.url);
    const { route, params } = this.router.match(
      `/${req.method}${url.pathname}`,
    );

    if (this.isViteNotFound(req.url, route, params)) {
      return;
    }

    if (!route) {
      // if no route is found, return basic 404
      // note: you should not use this in production, use a custom 404 page instead by adding a route /*
      ev.res = new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
      return;
    }

    const headers: Record<string, string> = {};

    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const query = Object.fromEntries(url.searchParams.entries());
    const method = (req.method.toUpperCase() ?? "GET") as RouteMethod;
    const request: ServerRequestData = {
      method,
      url,
      headers,
      params: params || {},
      query,
      raw: { web: ev },
    };

    const response = await route.handler(request).catch(() => {
      return {
        status: 500,
        headers: { "content-type": "text/plain" },
        body: this.internalServerErrorMessage,
      };
    });

    // empty body - just send status & headers
    if (!response.body) {
      ev.res = new Response(null, {
        status: response.status,
        headers: response.headers,
      });
      return;
    }

    // if response.body is string or buffer
    if (typeof response.body === "string") {
      ev.res = new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
      return;
    }

    if (Buffer.isBuffer(response.body)) {
      // Use Uint8Array to avoid Buffer pooling issues where .buffer returns
      // the entire underlying ArrayBuffer which may be larger than the actual data
      ev.res = new Response(new Uint8Array(response.body), {
        status: response.status,
        headers: response.headers,
      });
      return;
    }

    // if response.body is node stream
    if (response.body instanceof Readable) {
      ev.res = new Response(
        Readable.toWeb(response.body) as unknown as ReadableStream,
        {
          status: response.status,
          headers: response.headers,
        },
      );
      return;
    }

    // if response.body is web stream
    if (response.body instanceof ReadableStream) {
      ev.res = new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
      return;
    }

    // not supported response body type
    this.log.error(`Unknown response body type: ${typeof response.body}`);
    ev.res = new Response(this.internalServerErrorMessage, {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }

  /**
   * Helper for Vite development mode to let Vite handle (or not) 404.
   */
  protected isViteNotFound(
    url?: string,
    route?: Route,
    params?: Record<string, string>,
  ): boolean {
    if (this.alepha.isViteDev()) {
      if (!route) {
        return true;
      }

      url = url?.split("?")[0];

      if (!!params?.["*"] && `/${params?.["*"]}` === url) {
        return true;
      }
    }

    return false;
  }
}
