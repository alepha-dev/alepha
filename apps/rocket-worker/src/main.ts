import { Alepha, run } from "alepha";
import { RocketWorkerController } from "./RocketWorkerController.ts";

/**
 * rocket-worker — a Cloudflare Worker that fronts an Alepha Rocket
 * container with a REST API.
 *
 * Exposes:
 *   GET  /api/health            → health of the worker + container
 *   POST /api/deploys           → start a deploy (forwards to Rocket)
 *   GET  /api/deploys/:id       → poll a deploy by id
 *
 * The `$container<RocketController>` binding is declared inside
 * `RocketWorkerController`; `BuildCloudflareTask.enhanceContainers`
 * picks it up at build time and emits the wrangler.jsonc container
 * binding + Durable Object class declaration.
 */
const alepha = Alepha.create({
  env: {
    APP_NAME: "ROCKET_WORKER",
  },
});

alepha.with(RocketWorkerController);

run(alepha);
