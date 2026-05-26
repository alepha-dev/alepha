import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { DeployRegistry } from "../providers/DeployRegistry.ts";
import type { CreateDeploy } from "../schemas/deploy.ts";

/**
 * Runs a single deploy run end-to-end.
 *
 * Step 2 stub: marks the deploy `running`, simulates work, succeeds.
 * Step 3 will replace the body with the real pipeline:
 *
 *   1. download `artifact.bucket/key` from S3 → /tmp/<id>
 *   2. extract `tar.gz`
 *   3. resolve `alepha.config.ts` (bundled vs generated from `body.config`)
 *   4. bootstrap a child Alepha against the workspace with
 *      `AlephaPlatformPlugin`
 *   5. resolve `PlatformOrchestrator`, call `.up({ ..., prebuilt: true })`
 *      with a `RunnerMethod` piping output into the registry
 *   6. parse deployed URL → registry.succeed(id, url)
 */
export class DeployRunner {
  protected readonly log = $logger();
  protected readonly registry = $inject(DeployRegistry);

  public async run(id: string, _body: CreateDeploy): Promise<void> {
    this.registry.start(id);
    this.registry.append(id, "Deploy started (stub runner — step 2 lib).\n");

    // TODO step 3: replace with real S3 fetch + tar.gz extract +
    // PlatformOrchestrator.up({ prebuilt: true }).
    await new Promise((resolve) => setTimeout(resolve, 0));

    this.registry.append(
      id,
      "Stub runner complete. Wire S3 + orchestrator in step 3.\n",
    );
    this.registry.succeed(id);
  }
}
