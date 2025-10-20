import type { IncomingMessage } from "node:http";
import { createServer, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { $env, $hook, $inject, Alepha, type Static, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { ServerProvider } from "./ServerProvider.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

const envSchema = t.object({
  SERVER_PORT: t.int({
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

declare module "@alepha/core" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

export class NodeHttpServerProvider extends ServerProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly router = $inject(ServerRouterProvider);

  protected readonly server = createServer((req, res) => this.handle(req, res));

  protected readonly onNodeRequest = $hook({
    on: "node:request",
    handler: ({ req, res }) => this.handle(req, res),
  });

  public async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const { route, params } = this.router.match(`/${req.method}${req.url}`);

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
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const request = this.createRouterRequest(req, params);

    request.raw.node = { req, res };

    const response = await route.handler(request).catch(() => {
      return {
        status: 500,
        headers: { "content-type": "text/plain" },
        body: "Internal Server Error",
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
        this.log.error("Error piping proxy response stream:", error);
      } finally {
        res.end();
      }
      return;
    }

    // not supported response body type

    this.log.error("Unknown response body type:", typeof response.body);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error");
  }

  public get hostname(): string {
    if (this.server.listening) {
      const address = this.server.address();
      if (typeof address === "object" && address !== null) {
        return `http://${this.env.SERVER_HOST}:${address.port}`;
      }
    }
    return `http://${this.env.SERVER_HOST}:${this.env.SERVER_PORT}`;
  }

  public readonly start = $hook({
    on: "start",
    handler: async () => {
      // do not start the server in serverless mode
      if (this.alepha.isServerless() || this.alepha.isViteDev()) {
        return;
      }

      await this.listen();
    },
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      // do not stop the server in serverless mode
      if (this.alepha.isServerless() || this.alepha.isViteDev()) {
        return;
      }

      if (this.alepha.isProduction()) {
        await this.close();
        return;
      }

      // do not await in development & test
      this.close().catch();
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
