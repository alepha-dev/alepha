import { $inject } from "alepha";

import type { Head, SimpleHead } from "../interfaces/Head.ts";
import { HeadProvider } from "./HeadProvider.ts";

/**
 * Server-side head provider that fills head content from route configurations.
 *
 * Used by ReactServerProvider to collect title, meta tags, and other head
 * elements which are then rendered by ReactServerTemplateProvider.
 */
export class ServerHeadProvider {
  protected readonly headProvider = $inject(HeadProvider);

  /**
   * Resolve global head configuration (htmlAttributes only).
   *
   * Used for early streaming optimization - htmlAttributes can be sent
   * before page loaders run since they come from global $head only.
   */
  public resolveGlobalHead(): Head {
    return this.headProvider.resolveGlobalHead();
  }

  /**
   * Fill head state from route configurations.
   * Delegates to HeadProvider to merge head data from all route layers.
   */
  public fillHead(state: { head: SimpleHead; layers: Array<any> }): void {
    this.headProvider.fillHead(state as any);
  }
}
