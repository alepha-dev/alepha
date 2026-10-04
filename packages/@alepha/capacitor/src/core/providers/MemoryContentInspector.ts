import type { WebContent } from "../interfaces/WebContent.ts";
import { ContentInspector } from "./ContentInspector.ts";

/**
 * An inspector answering whatever a spec sets, `ota` included: the seam a
 * live updater fills.
 */
export class MemoryContentInspector extends ContentInspector {
  public content?: Omit<WebContent, "origin">;

  public override async inspect(): Promise<
    Omit<WebContent, "origin"> | undefined
  > {
    return this.content;
  }
}
