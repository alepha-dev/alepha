import { $module } from "alepha";

import { ReactAuth } from "./services/ReactAuth.ts";
import { ReactAuthTransport } from "./services/ReactAuthTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReactAuth = $module({
  name: "alepha.react.auth",
  services: [ReactAuthTransport, ReactAuth],
});
