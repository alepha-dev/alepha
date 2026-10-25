import { spawn } from "node:child_process";
import { createServer } from "node:net";

import { $hook, $inject, Alepha, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { AlephaServerStatic } from "alepha/server/static";

import { AlephaDevtoolsServer } from "../server/index.ts";
import { DevtoolsUi } from "./DevtoolsUi.ts";

/**
 * `npx @alepha/devtools`: start the devtools on this machine.
 *
 * A second container holds the server: this one is the CLI, which parses the
 * flags and stops the server when it is itself stopped.
 */
export class DevtoolsCommand {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  /**
   * The port the devtools has in the repository's dev band, tried first.
   */
  protected readonly defaultPort = 3310;

  /**
   * How many ports after the default to try before giving up.
   */
  protected readonly portAttempts = 20;

  protected server?: Alepha;

  public readonly serve = $command({
    root: true,
    description:
      "Open the Alepha devtools: every app running on this machine, inspected from one place.",
    flags: z.object({
      port: z
        .integer()
        .describe(
          "Port to listen on, on 127.0.0.1. Default: 3310, or the next free one.",
        )
        .optional(),
      open: z
        .boolean()
        .describe("Open the browser once listening (--no-open to skip).")
        .default(true),
    }),
    handler: async ({ flags }) => {
      const port = flags.port ?? (await this.freePort());

      const server = Alepha.create({
        env: {
          APP_NAME: "DEVTOOLS",
          SERVER_HOST: "127.0.0.1",
          SERVER_PORT: port,
          // The devtools is a tool, not an app to inspect, even when the
          // environment it starts in asked for the inspector.
          ALEPHA_INSPECT: "0",
        },
      })
        .with(AlephaServerStatic)
        .with(AlephaDevtoolsServer)
        .with(DevtoolsUi);

      await server.start();
      this.server = server;

      const url = `http://127.0.0.1:${port}/`;
      this.log.info(`Alepha DevTools on ${url}`);
      if (flags.open) {
        this.openBrowser(url);
      }
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.server?.stop();
      this.server = undefined;
    },
  });

  /**
   * The default port, or the next one free on 127.0.0.1.
   */
  protected async freePort(): Promise<number> {
    for (let i = 0; i < this.portAttempts; i++) {
      const port = this.defaultPort + i;
      if (await this.isFree(port)) return port;
    }
    throw new AlephaError(
      `No free port between ${this.defaultPort} and ${this.defaultPort + this.portAttempts - 1}: pass --port`,
    );
  }

  protected isFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => {
        probe.close(() => resolve(true));
      });
    });
  }

  /**
   * Hand the URL to the platform's opener. Best effort: a headless machine
   * has none, and the URL is printed either way.
   */
  protected openBrowser(url: string): void {
    const [command, args] =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : ["xdg-open", [url]];
    try {
      const child = spawn(command, args as string[], {
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => undefined);
      child.unref();
    } catch {
      // nothing to open with
    }
  }
}
