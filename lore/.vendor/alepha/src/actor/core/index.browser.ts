import { $module } from "alepha";

import { $actor } from "./primitives/$actor.ts";
import { ActorProvider } from "./providers/ActorProvider.ts";
export * from "./index.shared.ts";
export const AlephaActor = $module({
  name: "alepha.actor",
  primitives: [$actor],
  services: [ActorProvider],
});
