import { $module } from "alepha";

import { $actor } from "./primitives/$actor.ts";
import { ActorHostRegistry } from "./providers/ActorHostRegistry.ts";
import { ActorProvider } from "./providers/ActorProvider.ts";
import { CloudflareActorProvider } from "./providers/CloudflareActorProvider.ts";
export * from "./index.shared.ts";
export * from "./providers/AlephaActorDurableObject.ts";
export * from "./providers/CloudflareActorProvider.ts";
/**
 * Pure synchronous JSON reducers persisted in workerd Durable Objects.
 * Reads lazily initialize validated defaults. Transitions await storage, and
 * recreated hosts recover compatible committed snapshots. A missing binding
 * rejects execution without a Memory fallback. Socket room state stays volatile.
 *
 * @module alepha.actor
 */
export const AlephaActor = $module({
  name: "alepha.actor",
  primitives: [$actor],
  services: [ActorProvider],
  variants: [CloudflareActorProvider],
  register: (alepha) => {
    alepha.inject(ActorHostRegistry).register(ActorHostRegistry.actor);
    alepha.with({ provide: ActorProvider, use: CloudflareActorProvider });
  },
});
