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

  public hasClient(): boolean {
    if (!this.alepha) {
      throw new AlephaError("ViteBuildProvider not initialized");
    }
    try {
      this.alepha.inject("ReactServerProvider");
      return true;
    } catch {
      return false;
    }
  }
}
