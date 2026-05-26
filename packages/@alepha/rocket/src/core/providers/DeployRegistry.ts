import { AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import type { CreateDeploy, Deploy } from "../schemas/deploy.ts";

/**
 * In-memory registry of deploy runs.
 *
 * No queue, no persistence, no DB. Rocket runs serially today but the
 * registry itself doesn't enforce that — concurrency control belongs to
 * the runner.
 *
 * Container recycling loses in-flight and historical entries. Accepted
 * for v1 — callers poll quickly and don't rely on long-term history.
 */
export class DeployRegistry {
  protected readonly log = $logger();
  protected readonly deploys = new Map<string, Deploy>();

  /**
   * Cap on the per-deploy log buffer. Long deploys can stream a lot of
   * output; we keep the tail so `GET /deploys/:id` stays bounded.
   */
  public static readonly LOG_MAX_BYTES = 256 * 1024;

  public create(body: CreateDeploy): Deploy {
    const id = crypto.randomUUID();
    const deploy: Deploy = {
      id,
      op: body.op,
      project: body.project,
      env: body.env,
      status: "queued",
      log: "",
      startedAt: new Date().toISOString(),
    };
    this.deploys.set(id, deploy);
    return deploy;
  }

  public get(id: string): Deploy | undefined {
    return this.deploys.get(id);
  }

  public require(id: string): Deploy {
    const deploy = this.deploys.get(id);
    if (!deploy) {
      throw new AlephaError(`Deploy "${id}" not found`);
    }
    return deploy;
  }

  public list(): Deploy[] {
    return Array.from(this.deploys.values()).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  public start(id: string): void {
    const deploy = this.require(id);
    this.deploys.set(id, { ...deploy, status: "running" });
  }

  public append(id: string, chunk: string): void {
    const deploy = this.deploys.get(id);
    if (!deploy) return;
    const combined = deploy.log + chunk;
    const trimmed =
      combined.length > DeployRegistry.LOG_MAX_BYTES
        ? combined.slice(combined.length - DeployRegistry.LOG_MAX_BYTES)
        : combined;
    this.deploys.set(id, { ...deploy, log: trimmed });
  }

  public succeed(id: string, deployedUrl?: string): void {
    const deploy = this.require(id);
    this.deploys.set(id, {
      ...deploy,
      status: "succeeded",
      deployedUrl,
      finishedAt: new Date().toISOString(),
    });
  }

  public fail(id: string, error: unknown): void {
    const deploy = this.require(id);
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown");
    this.deploys.set(id, {
      ...deploy,
      status: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
    });
    this.log.error(`Deploy "${id}" failed: ${message}`);
  }
}
