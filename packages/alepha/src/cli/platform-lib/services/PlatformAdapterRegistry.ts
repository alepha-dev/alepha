import { AlephaError, type Service } from "alepha";

import type { PlatformAdapter } from "../adapters/PlatformAdapter.ts";

/**
 * Which adapter classes this container knows, by the name an environment
 * writes in `alepha.config.ts`.
 *
 * ⚠️ **It holds classes, not instances, and that is the whole reason it
 * exists.** `PlatformOrchestrator` used to carry `$inject(BayAdapter)` and
 * `$inject(CloudflareAdapter)` as class fields, so importing the orchestrator
 * imported both adapters, and `BayAdapter` imports `ShellProvider`, which
 * imports `node:child_process`. The code would have run inside a Worker; it
 * could not be bundled for one. Resolution was already a switch on a string at
 * five call sites, so what had to go was the eager field rather than the
 * lookup.
 *
 * The entries are filled by whichever module registered - `alepha/cli/platform-lib`
 * lists both under Node, and its `workerd` entry lists only what a Worker can
 * bundle. So an adapter is missing here exactly when the runtime cannot run it,
 * and the refusal says which ones it does have rather than pretending the name
 * is a typo.
 */
export class PlatformAdapterRegistry {
  protected readonly adapters = new Map<string, Service<PlatformAdapter>>();

  /**
   * Registering the same name twice replaces it, so a consumer can substitute
   * one adapter without rebuilding the map.
   */
  public set(name: string, adapter: Service<PlatformAdapter>): this {
    this.adapters.set(name, adapter);
    return this;
  }

  public has(name: string): boolean {
    return this.adapters.has(name);
  }

  public names(): string[] {
    return [...this.adapters.keys()].sort();
  }

  public get(name: string): Service<PlatformAdapter> {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      const known = this.names();
      throw new AlephaError(
        known.length > 0
          ? `Unknown adapter: "${name}". This container knows ${known.map((it) => `"${it}"`).join(", ")}.`
          : `Unknown adapter: "${name}". This container has no platform adapter registered at all.`,
      );
    }
    return adapter;
  }
}
