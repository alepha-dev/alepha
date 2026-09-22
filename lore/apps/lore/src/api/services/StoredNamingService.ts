import { AlephaError } from "alepha";
import { NamingContext, NamingService } from "alepha/cli/platform-lib";

/**
 * The naming a Lore deploy provisions under: the copy's stored name, as is.
 *
 * `NamingService` composes `<project>-<env>` from the platform config, which
 * is right for `alepha platform` and wrong for a copy Lore has already named.
 * The name is decided on the copy's first deploy (`appInstances.resourceName`)
 * and must survive everything that could make a recomputation disagree with
 * it: a project rename, and an `app` or `env` renamed on the copy itself.
 * Cloudflare has no rename, so a different name is an empty database beside
 * the live one.
 *
 * Substituted for `NamingService` in `DeployRunner`'s per-deploy container
 * only, and handed the name with {@link use} before the orchestrator runs.
 * Lore's own container never sees it.
 */
export class StoredNamingService extends NamingService {
  protected name?: string;

  /**
   * The name every resource of this deploy carries.
   */
  public use(name: string): this {
    this.name = name;
    return this;
  }

  public override forContext(_project: string, _env: string): NamingContext {
    // ⚠️ Refused rather than falling back to the composed name: a fallback
    // here is exactly the silent recomputation this class exists to prevent.
    if (!this.name) {
      throw new AlephaError(
        "The deploy was given no resource name, so it will not provision under a derived one.",
      );
    }
    return new NamingContext(this.name);
  }
}
