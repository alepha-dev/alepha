import { Alepha } from "alepha";

import type { DesktopLogs } from "./DesktopLogs.ts";

/**
 * {@link DesktopLogs}`.rotate` for the supervisor Worker, which runs no
 * container of its own: one is created on first use.
 */
export class DesktopLogRotator {
  protected logs?: Promise<DesktopLogs>;

  public async rotate(file: string): Promise<void> {
    this.logs ??= (async () => {
      const { AlephaDesktopShell, DesktopLogs } = await import("../index.ts");
      const alepha = Alepha.create({
        env: { NODE_ENV: "production", LOG_LEVEL: "warn" },
      }).with(AlephaDesktopShell);
      return alepha.inject(DesktopLogs);
    })();
    await (await this.logs).rotate(file);
  }
}
