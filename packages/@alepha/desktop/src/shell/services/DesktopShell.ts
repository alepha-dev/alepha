import { $inject } from "alepha";
import { $logger } from "alepha/logger";

import { DesktopProtocol } from "../../core/DesktopProtocol.ts";
import {
  type DesktopConfig,
  desktopConfigSchema,
} from "../../core/schemas/desktopConfigSchema.ts";
import { InstanceLockProvider } from "../providers/InstanceLockProvider.ts";
import { SupervisorProvider } from "../providers/SupervisorProvider.ts";
import { WindowProvider } from "../providers/WindowProvider.ts";
import { DesktopPaths } from "./DesktopPaths.ts";

/**
 * What the generated shell entry hands the shell.
 */
export interface DesktopShellOptions {
  /**
   * The validated top-level `desktop` config.
   */
  config: DesktopConfig;

  /**
   * The server Worker bootstrap's module URL.
   */
  workerUrl: string;

  /**
   * Environment the app is created with, on top of the desktop defaults.
   */
  env?: Record<string, string>;
}

/**
 * The main thread of a desktop app: one window, one supervised server.
 *
 * 1. Validate the config; create the data and log folders; take the
 *    instance lock. A second launch shows an alert and exits 4, before any
 *    secret or database is touched.
 * 2. Start the server Worker (through the supervisor) with
 *    `SERVER_HOST=127.0.0.1`, `SERVER_PORT=0` and a fresh one-use launch
 *    capability. Not ready within 30 s, or failed: alert, exit 1.
 * 3. Open the window, hand its loop handle to the supervisor, load the
 *    bootstrap URL, and block in the window loop.
 * 4. The loop returns when the window closes (Cmd+Q included) or when the
 *    supervisor terminated it because the server died. Stop the server
 *    within 15 s: exit 0 only when its stop hooks finished. A crash: alert,
 *    exit 2. A stop that timed out or threw: exit 3.
 *
 * A window that cannot open (the native library failed to load) is an
 * alert and exit 5. Every alert names the log file.
 */
export class DesktopShell {
  protected readonly log = $logger();
  protected readonly window = $inject(WindowProvider);
  protected readonly lock = $inject(InstanceLockProvider);
  protected readonly supervisor = $inject(SupervisorProvider);
  protected readonly paths = $inject(DesktopPaths);
  protected readonly protocol = $inject(DesktopProtocol);

  /**
   * The exit codes, by outcome.
   */
  public readonly exitCodes = {
    ok: 0,
    startFailed: 1,
    crashed: 2,
    stopFailed: 3,
    alreadyRunning: 4,
    windowFailed: 5,
  } as const;

  /**
   * Run the app until its window closes, and answer the process exit code.
   */
  public async run(options: DesktopShellOptions): Promise<number> {
    const config = desktopConfigSchema.parse(options.config);
    const name = config.name;
    const logFile = this.paths.logFile(config.identifier);

    await this.paths.prepare(config.identifier);
    if (!(await this.lock.acquire(this.paths.lockFile(config.identifier)))) {
      await this.window.alert(
        `${name} is already running`,
        `Another ${name} window is open. Switch to it, or quit it before opening ${name} again.`,
      );
      return this.exitCodes.alreadyRunning;
    }

    try {
      return await this.serve(options, config, logFile);
    } finally {
      await this.lock.release();
    }
  }

  protected async serve(
    options: DesktopShellOptions,
    config: DesktopConfig,
    logFile: string,
  ): Promise<number> {
    const name = config.name;
    const capability = this.capability();
    const started = await this.supervisor.start(
      {
        name,
        identifier: config.identifier,
        capability,
        env: {
          NODE_ENV: "production",
          ...options.env,
          // Last: an app setting cannot widen the listener. DesktopServer
          // refuses an app that asks for anything else at bind time.
          SERVER_HOST: "127.0.0.1",
          SERVER_PORT: "0",
        },
      },
      options.workerUrl,
    );
    if (!started.ok) {
      this.log.error("The app failed to start", { message: started.message });
      await this.window.alert(
        `${name} could not start`,
        `${started.message}\n\nDetails are in ${logFile}`,
      );
      return this.exitCodes.startFailed;
    }

    try {
      await this.window.open({
        appName: name,
        title: config.window?.title ?? name,
        width: config.window?.width ?? 1200,
        height: config.window?.height ?? 800,
        resizable: config.window?.resizable ?? true,
      });
    } catch (error) {
      this.log.error("The window could not open", error);
      await this.supervisor.stop();
      await this.window
        .alert(
          `${name} could not open its window`,
          `${this.protocol.sanitize(error)}\n\nDetails are in ${logFile}`,
        )
        .catch(() => {});
      return this.exitCodes.windowFailed;
    }

    this.supervisor.attachWindow(this.window.handle());
    this.window.navigate(
      `${started.origin}/__alepha_desktop/bootstrap?capability=${capability}`,
    );
    await this.window.run();
    this.window.destroy();

    const shutdown = await this.supervisor.stop();
    if (shutdown.kind === "crashed") {
      this.log.error("The app stopped unexpectedly", {
        message: shutdown.message,
      });
      await this.window.alert(
        `${name} stopped unexpectedly`,
        `${shutdown.message}\n\nDetails are in ${logFile}`,
      );
      return this.exitCodes.crashed;
    }
    if (!shutdown.graceful) {
      this.log.error("The app did not stop cleanly", {
        message: shutdown.message,
      });
      return this.exitCodes.stopFailed;
    }
    return this.exitCodes.ok;
  }

  /**
   * A fresh 256-bit launch capability, hex.
   */
  protected capability(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
}
