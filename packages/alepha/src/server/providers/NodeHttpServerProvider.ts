import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
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

  public get hostname(): string {
    if (this.server.listening) {
      const address = this.server.address();
      if (typeof address === "object" && address !== null) {
        return `http://${this.env.SERVER_HOST}:${address.port}`;
      }
    }
    return `http://${this.env.SERVER_HOST}:${this.env.SERVER_PORT}`;
  }

  public readonly server = this.createHttpServer((req, res) => {
    this.log.trace(`Incoming Node.js message -> ${req.url}`);
    this.handleNodeRequest({ req, res }).catch((err) => {
      this.log.error("Error handling request", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
  });

  public readonly start = $hook({
    on: "start",
    handler: async () => {
      await this.listen();
      this.alepha.state.set("alepha.node.server", this.server);
    },
  });

  protected createHttpServer(
    func: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server {
    return createServer(
      {
        // nov 25 - keep connections alive for better performance, cuz we http/1.1 by default
        keepAlive: this.alepha.isProduction(),
      },
      func,
    );
  }

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      if (this.alepha.isProduction()) {
        await this.close();
        return;
      }

      // do not await in development & test
      this.close().catch(() => {});
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
        this.log.info(`Server listening on ${this.hostname}`);
        resolve();
      });

      this.server?.on("error", (err) => {
        reject(err);
      });
    });
  }

  protected async close() {
    const promise = new Promise<void>((resolve, reject) => {
      this.server?.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    await Promise.race([this.dateTimeProvider.wait(2000), promise]);

    this.log.info("Server closed");
  }
}
