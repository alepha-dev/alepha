import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import { DeployRegistry } from "../providers/DeployRegistry.ts";
import { createDeploySchema, deploySchema } from "../schemas/deploy.ts";
import { DeployRunner } from "../services/DeployRunner.ts";

/**
 * The HTTP surface Rocket exposes. Consumed remotely via
 * `$container<RocketController>()` from `alepha/container` — the
 * resulting proxy mirrors the same `$action` methods, type-safe.
 *
 * Routes are propertyKey-based and all-POST so the proxy's wire
 * format (`POST /api/<methodName>`) can reach every action — the
 * `$container` proxy only emits POSTs.
 *
 * All routes are unauthenticated in v1. Rocket is meant to live
 * behind a Cloudflare Containers binding (or another internal-network
 * boundary). Adding auth is a v2 hardening item.
 */
export class RocketController {
  protected readonly registry = $inject(DeployRegistry);
  protected readonly runner = $inject(DeployRunner);

  /**
   * Start a deploy run. Returns the registered deploy immediately;
   * the actual work runs in the background. Poll `getDeploy` for status.
   *
   * Wire: `POST /api/createDeploy`.
   */
  public readonly createDeploy = $action({
    method: "POST",
    schema: {
      body: createDeploySchema,
      response: deploySchema,
    },
    handler: ({ body }) => {
      const deploy = this.registry.create(body);
      // Fire-and-forget. The runner updates the registry as work
      // progresses; the caller polls via getDeploy.
      void this.runner.run(deploy.id, body).catch((error) => {
        this.registry.fail(deploy.id, error);
      });
      return deploy;
    },
  });

  /**
   * Poll a deploy by id. Returns the current state including the log
   * tail (capped at `DeployRegistry.LOG_MAX_BYTES`).
   *
   * Wire: `POST /api/getDeploy/:id`.
   */
  public readonly getDeploy = $action({
    method: "POST",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: deploySchema,
    },
    handler: ({ params }) => this.registry.require(params.id),
  });

  /**
   * Recent deploys, newest first.
   *
   * Wire: `POST /api/listDeploys`.
   */
  public readonly listDeploys = $action({
    method: "POST",
    schema: {
      response: t.array(deploySchema),
    },
    handler: () => this.registry.list(),
  });

  /**
   * Liveness probe.
   *
   * Wire: `POST /api/health`.
   */
  public readonly health = $action({
    method: "POST",
    schema: {
      response: t.object({
        ok: t.boolean(),
      }),
    },
    handler: () => ({ ok: true }),
  });
}
