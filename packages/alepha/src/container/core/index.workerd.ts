import { $module } from "alepha";
import { $container } from "./primitives/$container.ts";
import { CloudflareContainerProvider } from "./providers/CloudflareContainerProvider.ts";
import { ContainerProvider } from "./providers/ContainerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./interfaces/ContainerOptions.ts";
export * from "./primitives/$container.ts";
export * from "./providers/CloudflareContainerProvider.ts";
export * from "./providers/ContainerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Type-safe RPC clients for ephemeral containerized Alepha apps,
 * Cloudflare workerd build.
 *
 * Auto-binds `CloudflareContainerProvider` so `$container()` calls
 * route through `env.<NAME>.getContainer(...).fetch()`. Pair with
 * `BuildCloudflareTask.enhanceContainers` (in `alepha/cli/core`) which
 * emits the wrangler.jsonc bindings and DO class declarations.
 *
 * @module alepha.container
 */
export const AlephaContainer = $module({
  name: "alepha.container",
  primitives: [$container],
  services: [ContainerProvider, CloudflareContainerProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: ContainerProvider,
      use: CloudflareContainerProvider,
    });
  },
});
