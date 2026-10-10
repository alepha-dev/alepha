import { Alepha } from "alepha";

import type { DesktopConfig } from "../../core/schemas/desktopConfigSchema.ts";
import { SupervisorProvider } from "../providers/SupervisorProvider.ts";
import { WindowProvider } from "../providers/WindowProvider.ts";
import { WorkerSupervisorProvider } from "../providers/WorkerSupervisorProvider.ts";
import { DesktopShell } from "./DesktopShell.ts";

/**
 * The process entry of a compiled desktop app: what the generated
 * `desktop-shell.js` calls, once.
 *
 * It builds the shell's own container (separate from the app's, which lives
 * in the server Worker), runs {@link DesktopShell} and exits with its code.
 * Anything thrown before the shell could report it (an invalid embedded
 * config, a container that fails to start) still ends in an alert and a
 * nonzero exit, never a silent quit.
 */
export class DesktopMain {
  /**
   * Run the app and exit the process.
   */
  public async run(options: {
    config: DesktopConfig;
    workerUrl: string;
    supervisorUrl: string;
  }): Promise<never> {
    let alepha: Alepha | undefined;
    try {
      const { AlephaDesktopShell } = await import("../index.ts");
      alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
        },
      }).with(AlephaDesktopShell);
      await alepha.start();
      const supervisor = alepha.inject(SupervisorProvider);
      if (supervisor instanceof WorkerSupervisorProvider) {
        supervisor.supervisorUrl = options.supervisorUrl;
      }
      const code = await alepha.inject(DesktopShell).run({
        config: options.config,
        workerUrl: options.workerUrl,
      });
      process.exit(code);
    } catch (error) {
      console.error(error);
      await alepha
        ?.inject(WindowProvider)
        .alert(
          `${options.config?.name ?? "The app"} could not start`,
          error instanceof Error ? error.message : String(error),
        )
        .catch(() => {});
      process.exit(1);
    }
  }
}
