import { $module } from "alepha";
import { cliConfigPlugins } from "alepha/cli/config";
import { type VendorOptions, vendorOptions } from "./atoms/vendorOptions.ts";
import { VendorCommand } from "./commands/VendorCommand.ts";
import { VendorService } from "./services/VendorService.ts";

// ---------------------------------------------------------------------------

declare module "alepha/cli/config" {
  interface AlephaCliConfig {
    vendor?: VendorOptions;
  }
}

// ---------------------------------------------------------------------------

/**
 * CLI plugin for vendoring Alepha packages into external projects.
 *
 * Copies package source code from a git remote into the current project's
 * `packages/` directory. Useful for corporate projects that need a local
 * copy of Alepha for AI tooling, audits, documentation, or quick fixes.
 *
 * Commands:
 * - `alepha vendor sync`  — replace local packages with remote source
 * - `alepha vendor diff`  — compare local packages against remote HEAD
 *
 * Configuration in `alepha.config.ts`:
 *
 * ```typescript
 * import { AlephaCliVendorPlugin } from "alepha/cli/vendor";
 *
 * export default defineConfig({
 *   services: [AlephaCliVendorPlugin],
 *   vendor: {
 *     branch: "main",
 *     packages: ["alepha", "@alepha/bucket-s3"],
 *   },
 * });
 * ```
 */
export const AlephaCliVendorPlugin = $module({
  name: "alepha.cli.plugins.vendor",
  atoms: [vendorOptions],
  services: [VendorCommand, VendorService],
});

// ---------------------------------------------------------------------------

cliConfigPlugins.push((config, alepha) => {
  if (config.vendor) {
    alepha.set(vendorOptions, config.vendor);
  }
});

// ---------------------------------------------------------------------------

export * from "./atoms/vendorOptions.ts";
export * from "./commands/VendorCommand.ts";
export * from "./services/VendorService.ts";
