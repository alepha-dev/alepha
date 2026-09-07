import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

// The types and the wire shape only. Everything else in this module reads a
// database or a permission registry, neither of which exists in a browser -
// but a client rendering a rank matrix needs the shape it is rendering.
export * from "./schemas/rankResourceSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiRanks = $module({
  name: "alepha.api.ranks",
});
