import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

// The types and the wire shape only. Everything else in this module reads a
// database or a permission registry, neither of which exists in a browser -
// but a client rendering a rank matrix needs the shape it is rendering.
export * from "./schemas/rankResourceSchema.ts";

// The controller's TYPE, so `useClient<RankController>()` in a browser knows
// what it is calling. `export type` is erased, so nothing in that file - the
// permission registry, the service, the repository - reaches the bundle.
export type { RankController } from "./controllers/RankController.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiRanks = $module({
  name: "alepha.api.ranks",
});
