import { $module } from "alepha";
import { AlephaPlatformLibPlugin } from "alepha/cli/platform-lib";
import { RocketController } from "./controllers/RocketController.ts";
import { DeployRegistry } from "./providers/DeployRegistry.ts";
import { ArtifactService } from "./services/ArtifactService.ts";
import { DeployRunner } from "./services/DeployRunner.ts";

/**
 * Alepha Rocket — remote `alepha platform` runner.
 *
 * Register on the Alepha app running inside the Rocket container image
 * (see `apps/rocket`). Consumers reach the container via
 * `$container<RocketController>()` from `alepha/container`.
 */
export const AlephaRocket = $module({
  name: "alepha.rocket",
  services: [
    AlephaPlatformLibPlugin,
    RocketController,
    DeployRegistry,
    DeployRunner,
    ArtifactService,
  ],
});

export * from "./controllers/RocketController.ts";
export * from "./providers/DeployRegistry.ts";
export * from "./schemas/deploy.ts";
export * from "./services/ArtifactService.ts";
export * from "./services/DeployRunner.ts";
