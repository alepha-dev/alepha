import { $module } from "alepha";
import { vendorOptions } from "./atoms/vendorOptions.ts";
import { VendorCommand } from "./commands/VendorCommand.ts";
import { VendorService } from "./services/VendorService.ts";

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
 * import { AlephaCliVendor } from "alepha/cli/vendor";
 *
 * export default defineConfig({
 *   services: [AlephaCliVendor],
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

export * from "./atoms/vendorOptions.ts";
export * from "./commands/VendorCommand.ts";
export * from "./services/VendorService.ts";
