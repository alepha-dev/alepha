import { $env, $hook, $inject, Alepha, type Infer, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ServerProvider } from "./ServerProvider.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

const envSchema = z.object({
  SERVER_PORT: z
    .integer()
    // `PORT` is what a host that allocates the port for you injects (Heroku,
    // Cloud Run, Railway, Fly), and it is read only when SERVER_PORT is unset.
    .meta({ min: 0, max: 65535, aliases: ["PORT"] })
    .describe("Set 0 to listen on a random port.")
    .default(3000),
  SERVER_HOST: z.text({
    default: "localhost",
    description: "Set 0.0.0.0 to listen on all interfaces.",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
}

export class BunHttpServerProvider extends ServerProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly router = $inject(ServerRouterProvider);

  protected bunServer?: ReturnType<typeof Bun.serve>;

  public get hostname(): string {
    if (this.bunServer) {
      return `http://${this.bunServer.hostname}:${this.bunServer.port}`;
    }
    return `http://${this.env.SERVER_HOST}:${this.env.SERVER_PORT}`;
  }

  public readonly start = $hook({
    on: "start",
    handler: async () => {
      await this.listen();
    },
  });

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

    try {
      this.bunServer = Bun.serve({
        port,
        hostname: this.env.SERVER_HOST,
        fetch: async (request: Request) => {
          this.log.trace(`Incoming Bun request -> ${request.url}`);

          // Create WebRequestEvent for handleWebRequest
          const webRequestEvent = {
            req: request,
            res: undefined as Response | undefined,
          };

          try {
            await this.handleWebRequest(webRequestEvent);

            if (!webRequestEvent.res) {
              // No response set, return 500
              return new Response("Internal Server Error", {
                status: 500,
                headers: { "content-type": "text/plain" },
              });
            }

            return webRequestEvent.res;
          } catch (err) {
            this.log.error("Error handling request", err);
            return new Response("Internal Server Error", {
              status: 500,
              headers: { "content-type": "text/plain" },
            });
          }
        },
        error: (error: Error) => {
          this.log.error("Bun server error", error);
          return new Response("Internal Server Error", {
            status: 500,
            headers: { "content-type": "text/plain" },
          });
        },
      });

      this.log.info(`Server listening on ${this.hostname}/`);
    } catch (err) {
      this.log.error("Failed to start Bun server", err);
      throw err;
    }
  }

  protected async close() {
    if (!this.bunServer) {
      return;
    }

    try {
      // Bun's server.stop() returns a promise that resolves when all connections are closed
      const stopPromise = this.bunServer.stop();

      // Race between stop completion and timeout
      await Promise.race([this.dateTimeProvider.wait(10000), stopPromise]);

      this.bunServer = undefined;
      this.log.info("Server closed");
    } catch (err) {
      this.log.error("Error closing Bun server", err);
      throw err;
    }
  }
}
