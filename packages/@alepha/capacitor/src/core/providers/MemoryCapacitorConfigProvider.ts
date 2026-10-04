import type { CapacitorPublicConfig } from "../schemas/capacitorPublicConfigSchema.ts";
import { CapacitorConfigProvider } from "./CapacitorConfigProvider.ts";

/**
 * A shell configuration set by hand, for specs. `undefined` is a web build.
 */
export class MemoryCapacitorConfigProvider extends CapacitorConfigProvider {
  public config?: CapacitorPublicConfig;

  protected override read(): CapacitorPublicConfig | undefined {
    return this.config;
  }
}
