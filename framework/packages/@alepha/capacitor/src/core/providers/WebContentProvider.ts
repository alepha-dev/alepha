import { $inject } from "alepha";

import type { WebContent } from "../interfaces/WebContent.ts";
import { ContentInspector } from "./ContentInspector.ts";

/**
 * Read-only: where the running web layer came from.
 *
 * `undefined` in a plain website. In a shell, the mode comes from the
 * {@link ContentInspector} (the build's own answer, or an updater's) and the
 * origin from the page.
 */
export class WebContentProvider {
  protected readonly inspector = $inject(ContentInspector);

  public async content(): Promise<WebContent | undefined> {
    const inspected = await this.inspector.inspect();
    if (!inspected) {
      return undefined;
    }
    return { ...inspected, origin: this.origin() };
  }

  protected origin(): string {
    return typeof window === "undefined" ? "" : window.location.origin;
  }
}
