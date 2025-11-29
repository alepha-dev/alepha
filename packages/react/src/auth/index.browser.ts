import { $module } from "alepha";
import { ReactAuth } from "./services/ReactAuth.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReactAuth = $module({
  name: "alepha.react.auth",
  services: [ReactAuth],
});
