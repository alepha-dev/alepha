import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { ReadableStream as WebStream } from "node:stream/web";
import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { Route } from "alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type { ServerRawRequest } from "../interfaces/ServerRequest.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

/**
 * Base server provider to handle incoming requests and route them.
 *
 * This is the default implementation for serverless environments.
 */
export class ServerProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly router = $inject(ServerRouterProvider);
  protected readonly textEncoder = new TextEncoder();

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
   * Convert Node's IncomingMessage to Web Standard Request
   */
  protected nodeRequestToWebRequest(req: IncomingMessage): Request {
    const protocol = (req.socket as any).encrypted ? "https" : "http";
    const host = req.headers.host || "localhost";
    const url = `${protocol}://${host}${req.url}`;

    // convert Node headers to Web Standard Headers
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const v of value) {
            headers.append(key, v);
          }
        } else {
          headers.set(key, value);
        }
      }
    }

    // convert Node stream to Web Standard ReadableStream
    let body: ReadableStream | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = WebStream.from(req) as ReadableStream;
    }

    const requestInit: RequestInit = {
      method: req.method,
      headers,
      body,
    };

    if (body) {
      (requestInit as any).duplex = "half";
    }

    return new Request(url, requestInit);
  }

  /**
   * Handle Node.js HTTP request event.
   *
   * Technically, we just convert Node.js request to Web Standard Request.
   */
  public async handleNodeRequest(
    nodeRequestEvent: NodeRequestEvent,
  ): Promise<void> {
    const webRequest = this.nodeRequestToWebRequest(nodeRequestEvent.req);

    const webRequestEvent: WebRequestEvent = {
      req: webRequest,
      res: undefined,
    };

    await this.handleWebRequest(webRequestEvent);

    if (!webRequestEvent.res) {
      this.log.error("No response from web request handler");
      // no response set, return 500 (this should not happen)
      nodeRequestEvent.res.writeHead(500, { "content-type": "text/plain" });
      nodeRequestEvent.res.end("Internal Server Error");
      return;
    }

    nodeRequestEvent.res.statusCode = webRequestEvent.res.status;
    nodeRequestEvent.res.statusMessage = webRequestEvent.res.statusText;
    for (const [key, value] of webRequestEvent.res.headers) {
      nodeRequestEvent.res.setHeader(key, value);
    }

    if (!webRequestEvent.res.body) {
      nodeRequestEvent.res.end();
      return;
    }

    // convert Web Standard ReadableStream to Node.js Readable stream
    try {
      for await (const chunk of webRequestEvent.res.body) {
        nodeRequestEvent.res.write(chunk);
      }
    } catch (error) {
      this.log.error("Error piping proxy response stream:", error);
    } finally {
      nodeRequestEvent.res.end();
    }
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
    this.log.trace("Match", { route: route?.path || null, params });

    if (
      // if vite is running
      // and if no route or root-not-found-handler is matched
      // and if the request is for a static file (e.g. .js, .css, etc.)
      this.isViteNotFound(req.url, route, params)
    ) {
      // let vite handle the request
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
    const request: ServerRawRequest = {
      method,
      url,
      headers,
      params: params || {},
      query,
      raw: ev.req,
    };

    const response = await route.handler(request).catch(() => {
      return {
        status: 500,
        headers: { "content-type": "text/plain" },
        body: "Internal Server Error",
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
      ev.res = new Response(response.body.buffer as ArrayBuffer, {
        status: response.status,
        headers: response.headers,
      });
      return;
    }

    // if response.body is node stream
    if (response.body instanceof Readable) {
      ev.res = new Response(Readable.toWeb(response.body) as ReadableStream, {
        status: response.status,
        headers: response.headers,
      });
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
    ev.res = new Response("Internal Server Error", {
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

// ---------------------------------------------------------------------------------------------------------------------

export interface NodeRequestEvent {
  req: IncomingMessage;
  res: ServerResponse;
}

export interface WebRequestEvent {
  req: Request;
  res?: Response;
}
