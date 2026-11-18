import { AlephaError } from "alepha";
import { CloudflareD1Provider } from "alepha/orm";

/**
 * The narrow D1 seam under `LoreDatabase.primary()`: inside it, reads go to
 * the primary, so a read that must see the latest write never meets a stale
 * replica. Normal application reads keep the framework's configured session
 * behaviour. The atomic batch is the framework's `atomicBatch`.
 */
export class LorePrimaryD1Provider extends CloudflareD1Provider {
  public override get db(): CloudflareD1Provider["db"] {
    if (this.alepha.get("lore.database.primary")) {
      if (!this.drizzleDb)
        throw new AlephaError("D1 database is not initialized");
      return this.drizzleDb as unknown as CloudflareD1Provider["db"];
    }
    return super.db;
  }
}

declare module "alepha" {
  interface State {
    "lore.database.primary"?: boolean;
  }
}
