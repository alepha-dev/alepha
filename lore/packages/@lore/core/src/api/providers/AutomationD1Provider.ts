import { AlephaError } from "alepha";
import { CloudflareD1Provider } from "alepha/orm";

/**
 * The narrow D1 seam used by stored programs: inside
 * `AutomationDatabase.primary()`, reads go to the primary, for revocable
 * authority. Normal application reads keep the framework's configured
 * session behavior. The atomic batch is the framework's `atomicBatch`.
 */
export class AutomationD1Provider extends CloudflareD1Provider {
  public override get db(): CloudflareD1Provider["db"] {
    if (this.alepha.get("lore.automations.primary")) {
      if (!this.drizzleDb)
        throw new AlephaError("D1 database is not initialized");
      return this.drizzleDb as unknown as CloudflareD1Provider["db"];
    }
    return super.db;
  }
}

declare module "alepha" {
  interface State {
    "lore.automations.primary"?: boolean;
  }
}
