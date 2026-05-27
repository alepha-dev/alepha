import { Container } from "@cloudflare/containers";
import { $module } from "alepha";
import { $container } from "./primitives/$container.ts";
import { CloudflareContainerProvider } from "./providers/CloudflareContainerProvider.ts";
import { ContainerProvider } from "./providers/ContainerProvider.ts";

// Stash the Cloudflare Containers `Container` base class on globalThis
// so `BuildCloudflareTask`'s post-Vite-emitted entry
// (`dist/main.cloudflare.js`) can declare
// `class <T> extends globalThis.__alepha_CloudflareContainer` without
// introducing a bare `@cloudflare/containers` specifier.
//
// The entry is written AFTER Vite — anything Vite hasn't seen
// survives as an unresolved import all the way to workerd (where the
// upload is `no_bundle: true`). This side-effect runs whenever an app
// imports anything from `alepha/container` (Vite picks this file via
// the `workerd` export condition), so by the time the entry's
// `import "./index.js"` finishes, the global is set and the
// `extends` expression resolves.
(globalThis as any).__alepha_CloudflareContainer = Container;

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
