import { $module } from "alepha";

import { $actor } from "./primitives/$actor.ts";
import { ActorProvider } from "./providers/ActorProvider.ts";
import { MemoryActorProvider } from "./providers/MemoryActorProvider.ts";
export * from "./index.shared.ts";
export * from "./providers/MemoryActorProvider.ts";

/**
 * Pure synchronous JSON reducers with independent default/keyed snapshots.
 * Node and Bun use volatile per-container Memory unless Redis is selected.
 *
 * @module alepha.actor
 */
export const AlephaActor = $module({
  name: "alepha.actor",
  primitives: [$actor],
  services: [ActorProvider],
  variants: [MemoryActorProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: ActorProvider,
      use: MemoryActorProvider,
    });
  },
});
