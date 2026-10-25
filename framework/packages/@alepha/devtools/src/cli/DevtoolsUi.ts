import { $serve } from "alepha/server/static";

import { devtoolsAssets } from "../assets.ts";

/**
 * The prebuilt devtools UI, served at the root with a single-page fallback:
 * `/apps/<runId>/logs` is a client route, so any path the server does not
 * own answers `index.html`.
 */
export class DevtoolsUi {
  protected readonly ui = $serve({
    path: "/",
    root: devtoolsAssets.ui,
    historyApiFallback: true,
    silent: true,
  });
}
