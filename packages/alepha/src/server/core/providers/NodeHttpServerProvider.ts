import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { $env, $hook, $inject, Alepha, type Static, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ServerProvider } from "./ServerProvider.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

const envSchema = t.object({
  SERVER_PORT: t.integer({
    default: 3000,
    min: 0,
    max: 65535,
    description: "Set 0 to listen on a random port.",
  }),
  SERVER_HOST: t.text({
    default: "localhost",
    description: "Set 0.0.0.0 to listen on all interfaces.",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

export class NodeHttpServerProvider extends ServerProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly router = $inject(ServerRouterProvider);

  /**
   * Track active connections for fast shutdown.
   */
  protected readonly connections = new Set<Socket>();

  /**
   * Get number of active connections.
   */
  public getConnectionsCount(): number {
    return this.connections.size;
  }

  /**
   * Server options.
   */
  public readonly options = {
    /**
     * Graceful shutdown timeout in ms.
     * After this, remaining connections are forcefully closed.
     * @default 30000
     */
    shutdownTimeout: 10000,
  };

  public get hostname(): string {
    if (this.server.listening) {
      const address = this.server.address();
      if (typeof address === "object" && address !== null) {
        return `http://${this.env.SERVER_HOST}:${address.port}`;
      }
    }
    return `http://${this.env.SERVER_HOST}:${this.env.SERVER_PORT}`;
  }

  // Pre-bound error handler to avoid function allocation per request
  protected readonly handleRequestError = (res: ServerResponse, err: Error) => {
    this.log.error("Error handling request", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  };

  // P3: Pre-allocated event object to avoid { req, res } allocation per request
  // Safe because handleNodeRequest completes before the next request reuses this object
  protected readonly nodeRequestEvent = {
    req: null as unknown as IncomingMessage,
    res: null as unknown as ServerResponse,
  };

  public readonly server = this.createHttpServer((req, res) => {
    // Reuse pre-allocated event object instead of creating { req, res } per request
    const ev = this.nodeRequestEvent;
    ev.req = req;
    ev.res = res;
    // Note: handleNodeRequest returns a promise that resolves after response is sent
    this.handleNodeRequest(ev).catch((err) =>
      this.handleRequestError(res, err),
    );
  });

  public readonly start = $hook({
    on: "start",
    handler: async () => {
      await this.listen();
      this.alepha.store.set("alepha.node.server", this.server);
    },
  });

  protected createHttpServer(
    func: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server {
    const server = createServer(
      {
        // nov 25 - keep connections alive for better performance, cuz we http/1.1 by default
        keepAlive: this.alepha.isProduction(),
      },
      func,
    );

    // Track connections for fast shutdown
    server.on("connection", (socket) => {
      this.connections.add(socket);
      socket.on("close", () => this.connections.delete(socket));
    });

    return server;
  }

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      await this.close();
    },
  });

  protected async listen() {
    let port = this.env.SERVER_PORT;

    // for testing, use a random port if port is 3000 (default)
    if (this.alepha.isTest() && port === 3000) {
      port = 0;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(port, this.env.SERVER_HOST, () => {
        this.log.info(`Server listening on ${this.hostname}/`);
        resolve();
      });

      this.server?.on("error", (err) => {
        reject(err);
      });
    });
  }

  protected async close() {
    // Dev/Test: instant shutdown (destroy connections immediately)
    // Production: graceful shutdown (wait for requests to complete, then close)
    if (!this.alepha.isProduction()) {
      this.destroyAllConnections();
    }

    // Stop accepting new connections
    const closePromise = new Promise<void>((resolve, reject) => {
      this.server?.close((err) => (err ? reject(err) : resolve()));
    });

    if (this.alepha.isProduction() && this.connections.size > 0) {
      // In production, wait for connections with timeout
      const timeout = this.options.shutdownTimeout;

      // Set up timeout to force-close connections
      const timeoutId = setTimeout(() => {
        if (this.connections.size > 0) {
          this.log.warn(
            `Shutdown timeout (${timeout}ms) reached, forcing ${this.connections.size} connections to close`,
          );
          // Destroy sockets - this triggers 'close' events which eventually resolves closePromise
          for (const socket of this.connections) {
            socket.destroy();
          }
        }
      }, timeout);

      // Wait for server to fully close (all connections closed)
      await closePromise;
      clearTimeout(timeoutId);
      this.connections.clear();
    } else {
      await closePromise;
    }

    this.log.info("Server closed");
  }

  protected destroyAllConnections() {
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
  }
}
