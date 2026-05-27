import type { RocketController } from "@alepha/rocket";
import { t } from "alepha";
import { $container } from "alepha/container";
import { $action } from "alepha/server";

// Schemas inlined (not imported from @alepha/rocket) so the worker
// bundle doesn't pull in the Rocket package's CLI/Node deps —
// `readline/promises`, `child_process`, etc. — which workerd
// doesn't ship. Type-only imports stay free.
const createDeployBody = t.object({
  op: t.enum(["up", "down"]),
  project: t.text(),
  env: t.text(),
  artifact: t.object({ bucket: t.text(), key: t.text() }),
  config: t.optional(
    t.object({
      hostname: t.optional(t.text()),
      vars: t.optional(t.record(t.text(), t.text())),
      secrets: t.optional(t.record(t.text(), t.text())),
    }),
  ),
});

const deployResponse = t.object({
  id: t.uuid(),
  op: t.enum(["up", "down"]),
  project: t.text(),
  env: t.text(),
  status: t.enum(["queued", "running", "succeeded", "failed"]),
  log: t.string({ maxLength: 256 * 1024 }),
  deployedUrl: t.optional(t.text()),
  error: t.optional(t.string({ maxLength: 64 * 1024 })),
  startedAt: t.datetime(),
  finishedAt: t.optional(t.datetime()),
});

/**
 * REST surface for Alepha Rocket, fronted by a Cloudflare Container.
 *
 * The `$container<RocketController>` binding routes through the
 * Cloudflare Containers binding (auto-emitted into `wrangler.jsonc`
 * by `BuildCloudflareTask.enhanceContainers`). On every call the
 * worker runtime resolves `env.ROCKET.getContainer("shared")` and
 * forwards the request to the bundled Alepha Rocket app inside the
 * container.
 *
 * `envVars` are read from `process.env` at build time and baked into
 * the generated `Container` subclass — set them in `.env.production`
 * before running `alepha platform up` and they end up in the
 * container's runtime env. The Rocket image itself only needs
 * `wrangler` installed; everything else is bundled into its `dist/`.
 */
export class RocketWorkerController {
  protected readonly rocket = $container<RocketController>({
    name: "rocket",
    // CF Containers rejects `:latest` (`VALIDATE_INPUT: Latest tags
    // are not allowed`) and only pulls from `registry.cloudflare.com`
    // (DockerHub gives `IMAGE_REGISTRY_DOESNT_CONTAIN_IMAGE`). The
    // local image `alepha-rocket:0.1.0` is pushed there by
    // `yarn workspace rocket push --tag 0.1.0` via `wrangler containers
    // push`, which retags it to `registry.cloudflare.com/<account>/...`
    // implicitly. The deploy-time wrangler resolves the same short
    // form against the CF registry.
    image: "alepha-rocket:0.1.0",
    // `lite` (256MB / 1/16 vCPU) OOMs while shelling out to wrangler
    // during a deploy. `standard` (4GB / 1/4 vCPU) gives the deploy
    // pipeline room to breathe.
    instanceType: "standard",
    port: 3000,
    sleepAfter: [15, "minute"],
    envVars: {
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "",
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "",
      S3_REGION: process.env.S3_REGION ?? "auto",
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "",
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });

  /**
   * Health probe. Calls the container's own `health()` action — a
   * successful response confirms the worker → DO → container chain
   * is wired and reachable.
   *
   * GET so plain `curl` (and the e2e bash loop) can hit it without
   * thinking about method shape.
   */
  public readonly health = $action({
    method: "GET",
    path: "/health",
    schema: {
      response: t.object({
        ok: t.boolean(),
        container: t.object({ ok: t.boolean() }),
      }),
    },
    handler: async () => {
      const container = (await this.rocket.health()) as { ok: boolean };
      return { ok: true, container };
    },
  });

  /**
   * Start a deploy run. Body matches Rocket's `createDeploy` schema
   * (op, project, env, artifact, config). Returns the registered
   * deploy id; caller polls `GET /deploys/:id` for status.
   */
  public readonly createDeploy = $action({
    method: "POST",
    path: "/deploys",
    schema: {
      body: createDeployBody,
      response: deployResponse,
    },
    handler: async ({ body }) => {
      return (await this.rocket.createDeploy({ body })) as never;
    },
  });

  /**
   * Poll a deploy by id.
   */
  public readonly getDeploy = $action({
    method: "GET",
    path: "/deploys/:id",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: deployResponse,
    },
    handler: async ({ params }) => {
      return (await this.rocket.getDeploy({
        params: { id: params.id },
      })) as never;
    },
  });
}
