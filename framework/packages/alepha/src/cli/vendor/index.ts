import { $context, $module } from "alepha";

import { type VendorOptions, vendorOptions } from "./atoms/vendorOptions.ts";
import { VendorCommand } from "./commands/VendorCommand.ts";
import { VendorService } from "./services/VendorService.ts";

// ---------------------------------------------------------------------------

/**
 * CLI plugin for vendoring Alepha packages into external projects.
 *
 * Copies package source code from a git remote into the current project's
 * vendor directory (`.vendor/` by default). Useful for corporate projects that need a local
 * copy of Alepha for AI tooling, audits, documentation, or quick fixes.
 *
 * Commands:
 * - `alepha vendor sync`  - replace local packages with remote source
 * - `alepha vendor diff`  - compare local packages against remote HEAD
 *
 * Configuration in `alepha.config.ts`:
 *
 * ```typescript
 * import { vendor } from "alepha/cli/vendor";
 *
 * export default defineConfig({
 *   plugins: [
 *     vendor({
 *       branch: "main",
 *       packages: ["alepha", "@alepha/payments-stripe"],
 *     }),
 *   ],
 * });
 * ```
 *
 * @module alepha.cli.vendor
 */
export const AlephaCliVendorPlugin = $module({
  name: "alepha.cli.plugins.vendor",
  atoms: [vendorOptions],
  services: [VendorCommand, VendorService],
});

export const vendor = (options: VendorOptions) => {
  return () => {
    const { alepha } = $context();
    alepha.with(AlephaCliVendorPlugin).set(vendorOptions, options);
  };
};

// ---------------------------------------------------------------------------

export * from "./atoms/vendorOptions.ts";
export * from "./commands/VendorCommand.ts";
export * from "./services/VendorService.ts";
