import { $inject, type Alepha, AlephaError } from "alepha";
import { ViteUtils } from "../services/ViteUtils.ts";
import type { AppEntry } from "./AppEntryProvider.ts";

export class ViteBuildProvider {
  protected alepha?: Alepha;
  protected appEntry?: AppEntry;
  protected readonly viteUtils = $inject(ViteUtils);

  public async init(opts: { entry: AppEntry }) {
    const alepha = await this.viteUtils.runAlepha({
      entry: opts.entry,
      mode: "production",
    });

    this.alepha = alepha;
    this.appEntry = opts.entry;

    return alepha;
  }

  /**
   * Whether the app declares a browser entry of its own.
   *
   * `!== server` is load-bearing. `browser` is not left empty for a
   * server-only app — it resolves to the SERVER entry — so a bare truthiness
   * check is true for every app in the repo. The first version of this did
   * exactly that, and every server-only app started trying to bundle its
   * controllers for the browser: `"$action" is not exported by
   * server/core/index.browser.ts`, from a build that had been green for
   * months.
   */
  protected hasDistinctBrowserEntry(): boolean {
    const entry = this.appEntry;
    return !!entry?.browser && entry.browser !== entry.server;
  }

  public hasClient(): boolean {
    if (!this.alepha) {
      throw new AlephaError("ViteBuildProvider not initialized");
    }
    // A declared browser entry IS the client contract, and it settles the
    // question before anything else is asked.
    //
    // The probe below only reports whether the server-side analysis happened to
    // instantiate `ReactServerProvider`, which depends on when the router was
    // registered — an app that composes it asynchronously (an `await import()`
    // of its page tree) finishes analysis without it. The build then completes,
    // reports success, and ships with no client bundle and no public assets.
    // Found in an app that does exactly that.
    if (this.hasDistinctBrowserEntry()) {
      return true;
    }
    try {
      this.alepha.inject("ReactServerProvider");
      return true;
    } catch {
      return false;
    }
  }
}
