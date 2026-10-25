import type { WebContent } from "../interfaces/WebContent.ts";
import { WebContentProvider } from "./WebContentProvider.ts";

/**
 * Web content set by hand, every mode included, for specs.
 */
export class MemoryWebContentProvider extends WebContentProvider {
  public current?: WebContent;

  public override async content(): Promise<WebContent | undefined> {
    return this.current;
  }
}
