import { projectCapabilities, projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbVersionMismatchError } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { type Monitor, monitors } from "../entities/monitors.ts";

export type PushMonitorConfig = Pick<Monitor, "name"> &
  Partial<
    Pick<Monitor, "intervalSecs" | "timeoutSecs" | "confirmations" | "expect">
  >;

/**
 * Receipt credentials grant one write to one monitor, never project access.
 */
export class UptimePushService {
  protected readonly monitors = $repository(monitors);
  protected readonly projects = $repository(projects);
  protected readonly capabilities = $repository(projectCapabilities);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly clock = $inject(DateTimeProvider);

  protected mint(): { token: string; hash: string } {
    const token = `up_${this.crypto.randomText(32)}`;
    return { token, hash: this.crypto.hash(token) };
  }

  public async create(
    projectId: number,
    config: PushMonitorConfig,
  ): Promise<{ monitor: Monitor; token: string }> {
    const minted = this.mint();
    const now = this.clock.nowISOString();
    const monitor = await this.monitors.create({
      ...config,
      projectId,
      kind: "push",
      target: "",
      pushTokenHash: minted.hash,
      statusSince: now,
      nextCheckAt: now,
    });
    return { monitor, token: minted.token };
  }

  public async rotate(monitor: Monitor): Promise<string> {
    if (monitor.kind !== "push")
      throw new BadRequestError("Only push monitors have a receipt token");
    const minted = this.mint();
    monitor.pushTokenHash = minted.hash;
    await this.monitors.save(monitor);
    return minted.token;
  }

  public async accept(token: string): Promise<void> {
    if (!/^up_[a-zA-Z0-9_-]{32,128}$/.test(token))
      throw new NotFoundError("Unknown push token");
    const hash = this.crypto.hash(token);
    for (let attempt = 0; attempt < 3; attempt++) {
      const monitor = await this.monitors.findOne({
        where: { pushTokenHash: hash, kind: "push" },
      });
      if (!monitor) throw new NotFoundError("Unknown push token");
      const project = await this.projects.findOne({
        where: { id: monitor.projectId },
      });
      const capability = await this.capabilities.findOne({
        where: { projectId: monitor.projectId, key: "apps" },
      });
      if (!project || capability?.options.uptime !== true)
        throw new NotFoundError("Unknown push token");
      const now = this.clock.nowISOString();
      monitor.lastPushedAt = now;
      monitor.lastCheckedAt = now;
      monitor.failures = 0;
      try {
        await this.monitors.save(monitor);
        return;
      } catch (error) {
        if (!(error instanceof DbVersionMismatchError)) throw error;
      }
    }
    throw new ConflictError(
      "The monitor changed while accepting the push; retry the request",
    );
  }
}
