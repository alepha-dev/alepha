import { $module } from "alepha";

import { PasskeyClient } from "./services/PasskeyClient.ts";
import { ReactAuth } from "./services/ReactAuth.ts";
import { ReactAuthQueryReset } from "./services/ReactAuthQueryReset.ts";
import { ReactAuthTransport } from "./services/ReactAuthTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReactAuth = $module({
  name: "alepha.react.auth",
  services: [ReactAuthTransport, PasskeyClient, ReactAuth, ReactAuthQueryReset],
});
