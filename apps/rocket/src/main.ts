import { AlephaRocket } from "@alepha/rocket";
import { run } from "alepha";

/**
 * Alepha Rocket — remote `alepha platform` runner.
 *
 * Boots an Alepha app that exposes the `RocketController` HTTP surface
 * from `@alepha/rocket`. Designed to be packaged as a Docker image and
 * called over the network (via `$container<RocketController>()` on the
 * consumer side, or raw HTTP).
 *
 * v1 deploy target: Cloudflare Containers binding. The container needs:
 *   - `CF_API_TOKEN`            Cloudflare API token (Workers Scripts: Edit)
 *   - `S3_ENDPOINT`             S3-compatible bucket endpoint
 *   - `S3_REGION`               (R2 → `auto`)
 *   - `S3_ACCESS_KEY_ID`
 *   - `S3_SECRET_ACCESS_KEY`
 *   - `S3_BUCKET`               artifact bucket name
 *
 * See `apps/rocket/README.md` for the request shape and a curl example.
 */
run(AlephaRocket);
