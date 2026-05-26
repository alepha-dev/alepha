import { $module } from "alepha";
import { $container } from "./primitives/$container.ts";
import { ContainerProvider } from "./providers/ContainerProvider.ts";
import { MockContainerProvider } from "./providers/MockContainerProvider.ts";
import { NodeContainerProvider } from "./providers/NodeContainerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./interfaces/ContainerOptions.ts";
export * from "./primitives/$container.ts";
export * from "./providers/ContainerProvider.ts";
export * from "./providers/MockContainerProvider.ts";
export * from "./providers/NodeContainerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Type-safe RPC clients for ephemeral containerized Alepha apps.
 *
 * **Features:**
 * - `$container<T>()` directive returns a typed Proxy onto a remote
 *   Alepha controller's `$action` endpoints — the wire format is the
 *   same `POST /api/<method>` shape served by every Alepha server.
 * - Pluggable transport: Node (plain `fetch` against a configured URL),
 *   Mock (in-process call via `LinkProvider.follow` for tests),
 *   Cloudflare workerd (`getContainer().fetch()` through the Containers
 *   binding — see `alepha/containers` workerd entry).
 * - Build-time integration: `BuildCloudflareTask.enhanceContainers`
 *   emits the matching wrangler bindings and Durable Object class
 *   declarations.
 *
 * The Node binding is the "temporary, not perfect" path documented in
 * the spec — apps need to provide an explicit `url` per primitive
 * until a `target=docker` adapter ships.
 *
 * @module alepha.containers
 */
export const AlephaContainers = $module({
  name: "alepha.containers",
  primitives: [$container],
  services: [ContainerProvider],
  variants: [MockContainerProvider, NodeContainerProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: ContainerProvider,
      use: alepha.isTest() ? MockContainerProvider : NodeContainerProvider,
    });
  },
});
