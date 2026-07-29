import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { $env, $hook, $inject, Alepha, type Static, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ServerProvider } from "./ServerProvider.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

const envSchema = z.object({
  SERVER_PORT: z
    .integer()
    .meta({ min: 0, max: 65535 })
    .describe("Set 0 to listen on a random port.")
    .default(3000),
  SERVER_HOST: z.text({
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
     * @default 10000
     */
    shutdownTimeout: 10000,
  };

  public get hostname(): string {
    // sometimes hostname is called before .star(), so server may not be created yet (nor listening)
    if (this.server?.listening) {
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

  public server!: Server;

  public readonly configure = $hook({
    on: "configure",
    handler: async () => {
      this.server = this.createHttpServer();
    },
  });

  public readonly start = $hook({
    on: "start",
    handler: async () => {
      await this.listen();
    },
  });

  protected requestListener = (req: IncomingMessage, res: ServerResponse) => {
    const promise = this.handleNodeRequest({ req, res });
    promise.catch((err) => this.handleRequestError(res, err));
  };

  protected connectionListener = (socket: Socket) => {
    this.connections.add(socket);
    socket.on("close", () => this.connections.delete(socket));
  };

  protected createHttpServer(): Server {
    let server: Server;

    const existing = this.alepha.store.get("alepha.node.server");
    if (this.alepha.isViteDev() && existing) {
      server = existing;
      server.removeAllListeners("request");
      // --> server.removeAllListeners("connection");
    } else {
      server = createServer({
        // nov 25 - keep connections alive for better performance, cuz we http/1.1 by default
        keepAlive: this.alepha.isProduction(),
      });
    }

    server.on("request", this.requestListener);

    // Track connections for fast shutdown
    server.on("connection", this.connectionListener);

    return server;
  }

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      await this.close();
    },
  });

  protected async listen() {
    if (this.alepha.store.get("alepha.node.server")) {
      return;
    }

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

    this.alepha.store.set("alepha.node.server", this.server);
  }

  protected async close() {
    if (this.alepha.isViteDev()) {
      this.server.removeListener("request", this.requestListener);
      this.server.removeListener("connection", this.connectionListener);
      return;
    }

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
