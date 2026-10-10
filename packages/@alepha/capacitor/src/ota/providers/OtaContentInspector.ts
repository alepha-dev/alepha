import { $hook, $inject } from "alepha";

import { ContentInspector } from "../../core/providers/ContentInspector.ts";
import { UpdaterAdapter } from "./UpdaterAdapter.ts";

/**
 * Completes core's content inspector with the updater: a bundled shell
 * running a live update reports `ota` and the bundle's version, so
 * `WebContentProvider` can tell it from the built-in layer.
 */
export class OtaContentInspector {
  protected readonly inspector = $inject(ContentInspector);
  protected readonly updater = $inject(UpdaterAdapter);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      this.inspector.addSource(async (base) => {
        if (base.mode !== "bundled" || !this.updater.available()) {
          return undefined;
        }
        try {
          const current = await this.updater.current();
          return current.id === "builtin"
            ? undefined
            : { mode: "ota", bundleVersion: current.version };
        } catch {
          return undefined;
        }
      });
    },
  });
}
