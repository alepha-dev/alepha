import { $inject } from "alepha";

import type { WebContent } from "../interfaces/WebContent.ts";
import { CapacitorConfigProvider } from "./CapacitorConfigProvider.ts";

/**
 * Answers which web layer is running, for {@link WebContentProvider}.
 *
 * The base answer is the build's own: `bundled` or `dev`, from the public
 * configuration, never from the URL (a bundled shell and a dev server can
 * share a pathname). A live updater adds a source ({@link addSource}) that
 * answers `ota` and the bundle's version when one runs, so core never
 * imports an updater and runs without one. A source rather than a
 * substitution: the updater's module registers after this one has served.
 */
export class ContentInspector {
  protected readonly config = $inject(CapacitorConfigProvider);
  protected readonly sources: Array<
    (
      base: Omit<WebContent, "origin">,
    ) => Promise<Omit<WebContent, "origin"> | undefined>
  > = [];

  /**
   * Add a source asked after the build's own answer, the last added first.
   * It answers `undefined` to leave the answer as it is.
   */
  public addSource(
    source: (
      base: Omit<WebContent, "origin">,
    ) => Promise<Omit<WebContent, "origin"> | undefined>,
  ): void {
    this.sources.unshift(source);
  }

  public async inspect(): Promise<Omit<WebContent, "origin"> | undefined> {
    const config = this.config.get();
    if (!config) {
      return undefined;
    }
    const base: Omit<WebContent, "origin"> = { mode: config.mode };
    for (const source of this.sources) {
      const answer = await source(base);
      if (answer) {
        return answer;
      }
    }
    return base;
  }
}
