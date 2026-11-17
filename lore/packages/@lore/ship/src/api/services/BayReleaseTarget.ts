import { $inject, Alepha } from "alepha";

import { BayUpgrade } from "../schemas/BayUpgrade.ts";

/**
 * The Bay version this Lore installs on a host: the release Lore itself was
 * built from (#E152).
 *
 * Bay, Lore and the framework share one version and one tag, so the release
 * a Lore was deployed from is the newest one it knows to exist. Known lag: a
 * release deploys nothing, so after a tag Lore keeps its old target until
 * its own next deploy.
 *
 * A service of its own, and the one seam a spec substitutes: `alepha.meta`
 * is baked in by the build, and nothing built a spec.
 */
export class BayReleaseTarget {
  protected readonly alepha = $inject(Alepha);

  /**
   * `undefined` on a Lore with no release behind it, which then offers no
   * upgrade at all.
   */
  version(): string | undefined {
    return BayUpgrade.targetOf(this.alepha.meta.version);
  }
}
