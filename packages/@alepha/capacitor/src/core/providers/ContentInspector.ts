import { $inject } from "alepha";

import type { WebContent } from "../interfaces/WebContent.ts";
import { CapacitorConfigProvider } from "./CapacitorConfigProvider.ts";

/**
 * Answers which web layer is running, for {@link WebContentProvider}.
 *
 * The base answer is the build's own: `bundled` or `dev`, from the public
 * configuration, never from the URL (a bundled shell and a dev server can
 * share a pathname). A live updater substitutes this class to add `ota` and
 * the bundle's version, so core never imports an updater and runs without
 * one.
 */
export class ContentInspector {
  protected readonly config = $inject(CapacitorConfigProvider);

  public async inspect(): Promise<Omit<WebContent, "origin"> | undefined> {
    const config = this.config.get();
    return config ? { mode: config.mode } : undefined;
  }
}
