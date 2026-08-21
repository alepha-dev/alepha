import { $module } from "alepha";

import { HttpClient } from "./services/HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServer = $module({
  name: "alepha.server",
  primitives: [],
  services: [HttpClient],
});
