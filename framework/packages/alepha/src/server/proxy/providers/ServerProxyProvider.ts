import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { ReadableStream as WebStream } from "node:stream/web";

import { $hook, $inject, Alepha, AlephaError, TimeoutError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  routeMethods,
  type ServerHandler,
  type ServerRequest,
  ServerRouterProvider,
} from "alepha/server";

import {
  $proxy,
  type ProxyForwardedCredential,
  type ProxyPrimitiveOptions,
} from "../primitives/$proxy.ts";

export class ServerProxyProvider {
  protected readonly log = $logger();
  protected readonly routerProvider = $inject(ServerRouterProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The request headers that carry the caller's credentials, removed from
   * every proxied request unless the proxy's `forward` names them.
   */
  protected readonly credentials: readonly ProxyForwardedCredential[] = [
    "cookie",
    "authorization",
  ];

  /**
   * The proxies that forward a WebSocket upgrade (`websocket: true`), by the
   * path prefix they own.
   */
  protected readonly upgrades: ProxyUpgradeEntry[] = [];

  /**
   * The Node server the `upgrade` listener is attached to, and the listener.
   */
  protected upgradeServer?: NodeUpgradeServer;
  protected upgradeListener?: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;

  protected readonly configure = $hook({
    on: "configure",
    handler: () => {
      for (const proxy of this.alepha.primitives($proxy)) {
        this.createProxy(proxy.options);
      }
    },
  });

  /**
   * On Node an upgrade never reaches the router: it arrives on the HTTP
   * server's `upgrade` event. Listen there, and only when a proxy asked.
   */
  protected readonly ready = $hook({
    on: "ready",
    handler: () => {
      if (this.upgrades.length === 0) {
        return;
      }
      const server = this.resolveUpgradeServer();
      if (!server) {
        return;
      }
      this.upgradeServer = server;
      this.upgradeListener = (request, socket, head) => {
        void this.handleNodeUpgrade(request, socket, head);
      };
      server.on("upgrade", this.upgradeListener);
    },
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: () => {
      if (this.upgradeServer && this.upgradeListener) {
        this.upgradeServer.off("upgrade", this.upgradeListener);
      }
      this.upgradeServer = undefined;
      this.upgradeListener = undefined;
    },
  });

  public createProxy(options: ProxyPrimitiveOptions): void {
    if (options.disabled) {
      return;
    }

    const path = options.path;

    this.checkForward(options.forward);

    if (!path.endsWith("/*")) {
      throw new AlephaError("Proxy path should end with '/*'");
    }

    if (options.websocket) {
      this.upgrades.push({ prefix: path.slice(0, -1), options });
      this.alepha.store.set(
        "alepha.server.proxy.upgradePaths",
        this.upgradePaths(),
      );
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

      if (options.websocket && this.isUpgrade(request.headers)) {
        await this.proxyWebUpgrade(request, url, options);
        return;
      }

      const requestInit = {
        url: url.toString(),
        method: request.method,
        headers: {
          ...this.forwardedHeaders(request.headers, options.forward),
          "accept-encoding": "identity", // ignore compression
        },
        body: this.getRawRequestBody(request),
        // The upstream call stops when the client leaves (#E85).
        signal: request.signal,
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
      const response = await this.send(requestInit, options.timeout);

      request.reply.status = response.status;
      request.reply.headers = Object.fromEntries(response.headers.entries());
      // Hop-by-hop headers describe the upstream connection, not ours.
      for (const name of ["connection", "keep-alive", "transfer-encoding"]) {
        delete request.reply.headers[name];
      }
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

  /**
   * Refuse a `forward` naming anything but the two credentials: a typo
   * would otherwise forward nothing, silently.
   */
  protected checkForward(forward: readonly string[] | undefined): void {
    for (const name of forward ?? []) {
      if (!this.credentials.includes(name as ProxyForwardedCredential)) {
        throw new AlephaError(
          `$proxy forward accepts "cookie" and "authorization" only, not "${name}"`,
        );
      }
    }
  }

  /**
   * The request's headers without the credentials `forward` does not name.
   * Names are matched without regard to case.
   */
  public forwardedHeaders(
    headers: Record<string, unknown>,
    forward: readonly ProxyForwardedCredential[] = [],
  ): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [name, value] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      if (
        this.credentials.includes(lower as ProxyForwardedCredential) &&
        !forward.includes(lower as ProxyForwardedCredential)
      ) {
        continue;
      }
      out[name] = value;
    }
    return out;
  }

  /**
   * Send the upstream request, its headers bounded by `timeout` when there
   * is one. The deadline aborts the call only while it waits for the
   * headers: once they are in, the body streams for as long as the client
   * stays.
   */
  protected send(
    requestInit: RequestInit & { url: string },
    timeout: ProxyPrimitiveOptions["timeout"],
  ): Promise<Response> {
    if (!timeout) {
      return fetch(requestInit.url, requestInit);
    }
    const client = requestInit.signal ?? undefined;
    return this.dateTime.deadline(
      (signal) =>
        fetch(requestInit.url, {
          ...requestInit,
          signal: client ? AbortSignal.any([client, signal]) : signal,
        }),
      timeout,
      { ambient: false },
    );
  }

  // -------------------------------------------------------------------------------------------------------------------
  // WebSocket upgrades

  /**
   * The path prefixes whose upgrades a proxy owns, as `alepha/websocket`
   * reads them to leave those sockets alone.
   */
  public upgradePaths(): string[] {
    return this.upgrades.map((entry) => entry.prefix);
  }

  protected isUpgrade(headers: Record<string, unknown>): boolean {
    const upgrade = headers.upgrade;
    return typeof upgrade === "string" && upgrade.toLowerCase() === "websocket";
  }

  /**
   * An upgrade that came through the router: a web runtime (workerd, Bun).
   *
   * workerd: the upstream is fetched with the handshake's headers, and its
   * 101 Response, which carries the upstream `webSocket`, goes back to the
   * client untouched; the runtime pipes the frames and closes each side
   * with the other. Bun: refused with 501, since Bun's server is started
   * without a WebSocket handler.
   */
  protected async proxyWebUpgrade(
    request: ServerRequest,
    url: URL,
    options: Omit<ProxyPrimitiveOptions, "path">,
  ): Promise<void> {
    if (this.alepha.isBun()) {
      this.log.warn("WebSocket proxying is not supported on Bun, refused", {
        path: request.url.pathname,
      });
      request.reply.status = 501;
      request.reply.headers["content-type"] = "text/plain";
      request.reply.body = "WebSocket proxying is not supported on Bun";
      return;
    }

    url.protocol = url.protocol === "wss:" ? "https:" : url.protocol;
    url.protocol = url.protocol === "ws:" ? "http:" : url.protocol;

    const requestInit = {
      url: url.toString(),
      method: "GET",
      headers: this.forwardedHeaders(request.headers, options.forward),
      signal: request.signal,
    };
    delete (requestInit.headers as Record<string, unknown>).host;

    if (options.beforeRequest) {
      await options.beforeRequest(request, requestInit);
    }

    const response = await this.send(requestInit, options.timeout);
    if (response.status === 101) {
      request.reply.status = 101;
      request.reply.native = response;
      return;
    }

    // The upstream refused the upgrade: its answer goes back as any other.
    request.reply.status = response.status;
    request.reply.headers = Object.fromEntries(response.headers.entries());
    request.reply.body = response.body;
  }

  /**
   * The server an `upgrade` listener goes on: the app's own Node server, or
   * Vite's under `alepha dev`. None on a web runtime.
   */
  protected resolveUpgradeServer(): NodeUpgradeServer | undefined {
    const own = this.alepha.store.get("alepha.node.server") as
      | NodeUpgradeServer
      | undefined;
    if (own) {
      return own;
    }
    const vite = this.alepha.store.get("alepha.vite.server" as any) as
      | { httpServer?: NodeUpgradeServer | null }
      | undefined;
    return vite?.httpServer ?? undefined;
  }

  /**
   * A Node `upgrade` event. A path no websocket proxy owns is left to the
   * server's other listeners (`alepha/websocket`, Vite's HMR); when there
   * is none, its socket is destroyed, as Node does with no listener at all.
   */
  protected async handleNodeUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const incoming = new URL(req.url ?? "/", "http://localhost");
    const entry = this.upgrades.find(
      (it) =>
        incoming.pathname.startsWith(it.prefix) ||
        `${incoming.pathname}/` === it.prefix,
    );
    if (!entry || !this.isUpgrade(req.headers)) {
      if (
        this.upgradeServer &&
        this.upgradeServer.listenerCount("upgrade") <= 1 &&
        !this.alepha.isViteDev()
      ) {
        socket.destroy();
      }
      return;
    }

    const options = entry.options;
    try {
      const target =
        typeof options.target === "function"
          ? options.target()
          : options.target;
      const url = new URL(target + incoming.pathname);
      url.search = incoming.search;
      options.rewrite?.(url);
      const secure = url.protocol === "https:" || url.protocol === "wss:";

      const headers: Record<string, string | string[] | undefined> = {
        ...req.headers,
      };
      // An upgrade bypasses `server:request:before` on Node, so nothing
      // derived an `Authorization` from the session cookie as it does for
      // every routed request, workerd's upgrade included. Do it here, when
      // the proxy forwards it, so both runtimes send the same header.
      if (
        options.forward?.includes("authorization") &&
        !headers.authorization &&
        typeof headers.cookie === "string"
      ) {
        const token = await this.accessTokenFromCookie(headers.cookie);
        if (token) {
          headers.authorization = `Bearer ${token}`;
        }
      }

      const requestInit = {
        url: url.toString(),
        method: "GET",
        headers: this.forwardedHeaders(headers, options.forward),
      };
      delete (requestInit.headers as Record<string, unknown>).host;

      if (options.beforeRequest) {
        await options.beforeRequest(
          this.handshakeRequest(req, incoming, headers),
          requestInit,
        );
      }

      const upstream = await this.connectNodeUpstream(
        new URL(requestInit.url),
        secure,
        new Headers(requestInit.headers as HeadersInit),
        options.timeout,
      );

      if (upstream.kind === "response") {
        socket.write(this.statusBlock(upstream.res, upstream.res.statusCode));
        upstream.res.pipe(socket);
        return;
      }

      const { res, socket: upSocket, head: upHead } = upstream;
      socket.write(this.statusBlock(res, 101, "Switching Protocols"));
      if (upHead.length > 0) {
        socket.write(upHead);
      }
      if (head.length > 0) {
        upSocket.write(head);
      }
      upSocket.on("error", () => socket.destroy());
      socket.on("error", () => upSocket.destroy());
      upSocket.on("close", () => socket.destroy());
      socket.on("close", () => upSocket.destroy());
      socket.pipe(upSocket).pipe(socket);
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      this.log.warn("WebSocket proxy handshake failed", {
        path: incoming.pathname,
        error,
      });
      socket.end(
        timedOut
          ? "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
          : "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    }
  }

  /**
   * Open the upstream handshake with `node:http`, which carries an upgrade
   * where the global `fetch` cannot. Settles on the upstream's 101 or on any
   * other response; `timeout` bounds the wait for either.
   */
  protected async connectNodeUpstream(
    url: URL,
    secure: boolean,
    headers: Headers,
    timeout: ProxyPrimitiveOptions["timeout"],
  ): Promise<NodeUpstream> {
    const http = secure
      ? await import("node:https")
      : await import("node:http");
    const outgoing: Record<string, string> = {};
    headers.forEach((value, key) => {
      outgoing[key] = value;
    });
    outgoing.connection = "Upgrade";
    outgoing.upgrade = "websocket";

    const connect = (signal?: AbortSignal) =>
      new Promise<NodeUpstream>((resolve, reject) => {
        const req = http.request({
          protocol: secure ? "https:" : "http:",
          hostname: url.hostname,
          port: url.port || (secure ? 443 : 80),
          path: url.pathname + url.search,
          method: "GET",
          headers: outgoing,
        });
        const onAbort = () => {
          req.destroy();
          reject(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        req.on("upgrade", (res, socket, head) => {
          signal?.removeEventListener("abort", onAbort);
          resolve({ kind: "upgrade", res, socket, head });
        });
        req.on("response", (res) => {
          signal?.removeEventListener("abort", onAbort);
          resolve({ kind: "response", res });
        });
        req.on("error", (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        });
        req.end();
      });

    if (!timeout) {
      return connect();
    }
    return this.dateTime.deadline((signal) => connect(signal), timeout, {
      ambient: false,
    });
  }

  /**
   * The status line and headers of an upstream answer, for a raw socket.
   */
  protected statusBlock(
    res: IncomingMessage,
    status: number | undefined,
    message?: string,
  ): string {
    const lines = [
      `HTTP/1.1 ${status ?? 502} ${message ?? res.statusMessage ?? ""}`,
    ];
    for (let i = 0; i < res.rawHeaders.length; i += 2) {
      lines.push(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`);
    }
    return `${lines.join("\r\n")}\r\n\r\n`;
  }

  /**
   * What `beforeRequest` receives for a Node handshake, which never became
   * a routed request: its method, URL and headers.
   */
  protected handshakeRequest(
    req: IncomingMessage,
    url: URL,
    headers: Record<string, unknown>,
  ): ServerRequest {
    return {
      method: "GET",
      url,
      headers,
      params: {},
      query: Object.fromEntries(url.searchParams.entries()),
      raw: { node: { req } },
    } as unknown as ServerRequest;
  }

  /**
   * The session's access token from a cookie header, through
   * `alepha/server/auth` when the app registered it.
   */
  protected async accessTokenFromCookie(
    cookie: string,
  ): Promise<string | undefined> {
    try {
      const auth = this.alepha.inject("alepha.server.ServerAuthProvider") as {
        accessTokenFromCookieHeader(
          header: string,
        ): Promise<string | undefined>;
      };
      return await auth.accessTokenFromCookieHeader(cookie);
    } catch {
      return undefined;
    }
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

// ---------------------------------------------------------------------------------------------------------------------

interface ProxyUpgradeEntry {
  prefix: string;
  options: ProxyPrimitiveOptions;
}

interface NodeUpgradeServer {
  on(event: "upgrade", listener: (...args: any[]) => void): unknown;
  off(event: "upgrade", listener: (...args: any[]) => void): unknown;
  listenerCount(event: "upgrade"): number;
}

type NodeUpstream =
  | { kind: "upgrade"; res: IncomingMessage; socket: Duplex; head: Buffer }
  | { kind: "response"; res: IncomingMessage };
