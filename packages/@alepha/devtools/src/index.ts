import { $module } from "alepha";
import { AlephaInspector, InspectorRoutes } from "alepha/inspector";
import { AlephaServer } from "alepha/server";
import { AlephaServerStatic } from "alepha/server/static";

import { DevToolsProvider } from "./providers/DevToolsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The in-app devtools UI, served by the application itself at `/__devtools`.
 *
 * What it shows comes from `alepha/inspector`, whose route table this module
 * mounts under `/__devtools/api`.
 *
 * @module alepha.devtools
 */
export const AlephaDevtools = $module({
  name: "alepha.devtools",
  primitives: [],
  register: (alepha) => {
    // SECURITY: the inspector's routes read and MUTATE application state
    // (arbitrary DB create/update/delete, atom writes) and serve the env,
    // secrets included, in cleartext. Mounted here they sit on the app's own
    // public port, so this refuses production outright, even where the
    // inspector itself was opted into: that opt-in is for its socket.
    if (alepha.isProduction()) {
      return;
    }

    alepha.with(AlephaInspector);

    // The inspector applies its own guard (development only, unless
    // `ALEPHA_INSPECT=1`); without its routes there is nothing to mount.
    if (!alepha.has(InspectorRoutes)) {
      return;
    }

    alepha.with(AlephaServer);
    alepha.with(AlephaServerStatic);
    alepha.with(DevToolsProvider);
  },
});
