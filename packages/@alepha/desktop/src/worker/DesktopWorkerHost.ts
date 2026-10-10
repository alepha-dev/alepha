import type { Alepha, RunHost, RunOptions } from "alepha";
import { AlephaError } from "alepha";

import { DesktopProtocol } from "../core/DesktopProtocol.ts";
import type { DesktopShellMessage } from "../core/schemas/desktopShellMessageSchema.ts";
import type { DesktopWorkerMessage } from "../core/schemas/desktopWorkerMessageSchema.ts";
import { DesktopDataDefaults } from "./DesktopDataDefaults.ts";
import { DesktopServer } from "./DesktopServer.ts";

/**
 * The part of a Worker's global scope the host uses: `self` in a Bun Worker.
 */
export interface DesktopWorkerScope {
  postMessage: (message: DesktopWorkerMessage) => void;
  addEventListener: (
    type: "message",
    listener: (event: { data: unknown }) => void,
  ) => void;
}

/**
 * The Worker side of a desktop app: it owns the app's lifecycle in place of
 * `run()`, and speaks {@link DesktopProtocol} to the shell.
 *
 * The generated Worker bootstrap is two lines:
 *
 * ```ts
 * import { DesktopWorkerHost } from "@alepha/desktop/worker";
 * new DesktopWorkerHost(self, () => import("./index.bun.js")).listen();
 * ```
 *
 * On `init` it applies the environment, installs itself as the run host,
 * wraps `Bun.serve`, then imports the entry. The import resolving means the
 * whole entry wrapper ran, SSR manifest and embedded public files included,
 * and `run()` handed the app over without scheduling anything. Only then:
 * `configure`, `start`, `ready`, and `ready { origin }` to the shell. A
 * failure anywhere stops what started and answers `failed` with the message
 * alone.
 *
 * ⚠️ **The app is driven only through its instance.** The app bundle carries
 * its own copy of `alepha`, so a `$hook` or a class token from this package
 * would belong to a different container. `alepha.start()`, `stop()` and the
 * shared `Bun.serve` are what both copies agree on.
 */
export class DesktopWorkerHost implements RunHost {
  protected readonly protocol = new DesktopProtocol();
  protected readonly dataDefaults = new DesktopDataDefaults();
  protected state: "idle" | "starting" | "ready" | "stopping" | "stopped" =
    "idle";
  protected app?: { alepha: Alepha; options?: RunOptions };
  protected starting?: Promise<void>;

  protected readonly scope: DesktopWorkerScope;
  protected readonly entry: () => Promise<unknown>;
  protected readonly server: DesktopServer;
  protected readonly env: Record<string, string | undefined>;

  constructor(
    scope: DesktopWorkerScope,
    entry: () => Promise<unknown>,
    server: DesktopServer = new DesktopServer(),
    env: Record<string, string | undefined> = process.env,
  ) {
    this.scope = scope;
    this.entry = entry;
    this.server = server;
    this.env = env;
  }

  /**
   * Install the message listener. Call it synchronously in the bootstrap,
   * before any await, or the shell's `init` can arrive with nobody listening.
   */
  public listen(): this {
    this.scope.addEventListener("message", (event) => {
      void this.onMessage(event.data);
    });
    return this;
  }

  /**
   * Called by `run()` instead of scheduling the start. See `RunHost`.
   */
  public attach(alepha: Alepha, options: RunOptions | undefined): void {
    if (this.app) {
      throw new AlephaError(
        "run() was called twice: a desktop app hosts exactly one application.",
      );
    }
    if (options?.once) {
      throw new AlephaError(
        "run({ once: true }) cannot be hosted in a desktop window: a window app stops when its window closes.",
      );
    }
    this.app = { alepha, options };
  }

  protected async onMessage(data: unknown): Promise<void> {
    const message = this.protocol.parseShellMessage(data);
    if (!message) {
      this.post({
        type: "failed",
        phase: "protocol",
        message:
          "The desktop shell sent a message this Worker does not understand.",
      });
      return;
    }
    if (message.type === "init") {
      this.starting = this.init(message);
      await this.starting;
      return;
    }
    await this.stop();
  }

  protected async init(
    message: Extract<DesktopShellMessage, { type: "init" }>,
  ): Promise<void> {
    if (this.state !== "idle") {
      this.post({
        type: "failed",
        phase: "protocol",
        message: "The desktop shell sent init twice.",
      });
      return;
    }
    this.state = "starting";

    try {
      for (const [key, value] of Object.entries(message.env) as Array<
        [string, string]
      >) {
        this.env[key] = value;
      }
      for (const [key, value] of Object.entries(message.defaults) as Array<
        [string, string]
      >) {
        if (this.env[key] === undefined || this.env[key] === "") {
          this.env[key] = value;
        }
      }
      (globalThis as any)[Symbol.for("alepha.run.host")] = this;
      this.server.install();

      await this.entry();

      if (!this.app) {
        throw new AlephaError(
          "The server entry did not call run(): there is no application to start.",
        );
      }
      const { alepha, options } = this.app;
      // Before configure: an app's own configure hook still sees, and may
      // override, the desktop defaults.
      this.dataDefaults.apply(alepha, message.paths);
      await options?.configure?.(alepha);
      await alepha.start();
      await options?.ready?.(alepha);

      const origin = this.server.origin();
      if (!origin) {
        throw new AlephaError(
          "The application started without an HTTP server: a desktop window needs one.",
        );
      }
      if (this.state !== "starting") {
        // `stop` arrived while starting: it is waiting on this promise.
        return;
      }
      this.state = "ready";
      this.post({ type: "ready", version: 1, origin });
    } catch (error) {
      await this.app?.alepha.stop().catch(() => {});
      this.state = "stopped";
      this.post({
        type: "failed",
        phase: "start",
        message: this.protocol.sanitize(error),
      });
    }
  }

  protected async stop(): Promise<void> {
    if (this.state === "stopping" || this.state === "stopped") {
      return;
    }
    const wasStarting = this.state === "starting";
    this.state = "stopping";
    if (wasStarting) {
      await this.starting;
    }
    try {
      await this.app?.alepha.stop();
      this.state = "stopped";
      this.post({ type: "stopped" });
    } catch (error) {
      this.state = "stopped";
      this.post({
        type: "failed",
        phase: "stop",
        message: this.protocol.sanitize(error),
      });
    }
  }

  protected post(message: DesktopWorkerMessage): void {
    this.scope.postMessage(message);
  }
}
