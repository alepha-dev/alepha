import { $inject } from "alepha";

import type { WebContent } from "../../core/interfaces/WebContent.ts";
import { ContentInspector } from "../../core/providers/ContentInspector.ts";
import { UpdaterAdapter } from "./UpdaterAdapter.ts";

/**
 * Core's content inspector, completed by the updater: a shell running a
 * live update reports `ota` and the bundle's version, so
 * `WebContentProvider` can tell it from the built-in layer.
 */
export class OtaContentInspector extends ContentInspector {
  protected readonly updater = $inject(UpdaterAdapter);

  public override async inspect(): Promise<
    Omit<WebContent, "origin"> | undefined
  > {
    const base = await super.inspect();
    if (!base || base.mode !== "bundled" || !this.updater.available()) {
      return base;
    }
    try {
      const current = await this.updater.current();
      return current.id === "builtin"
        ? base
        : { mode: "ota", bundleVersion: current.version };
    } catch {
      return base;
    }
  }
}
