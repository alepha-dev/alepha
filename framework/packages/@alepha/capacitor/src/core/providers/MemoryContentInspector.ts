import type { WebContent } from "../interfaces/WebContent.ts";
import { ContentInspector } from "./ContentInspector.ts";

/**
 * An inspector answering whatever a spec sets, `ota` included, for specs
 * that need a running web layer without an updater.
 */
export class MemoryContentInspector extends ContentInspector {
  public content?: Omit<WebContent, "origin">;

  public override async inspect(): Promise<
    Omit<WebContent, "origin"> | undefined
  > {
    return this.content;
  }
}
