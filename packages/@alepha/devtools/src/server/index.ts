import { $module } from "alepha";
import { AlephaServer } from "alepha/server";

import { DevtoolsGuardProvider } from "./providers/DevtoolsGuardProvider.ts";
import { DevtoolsServerProvider } from "./providers/DevtoolsServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/DevtoolsGuardProvider.ts";
export * from "./providers/DevtoolsServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The devtools server: lists the apps running on this machine and proxies the
 * UI's requests to each one's inspector socket. Never imported by an app; the
 * `npx @alepha/devtools` bin runs it.
 */
export const AlephaDevtoolsServer = $module({
  name: "alepha.devtools.server",
  services: [DevtoolsGuardProvider, DevtoolsServerProvider],
  register: (alepha) => {
    alepha.with(AlephaServer);
  },
});
