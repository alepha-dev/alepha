import { $atom, type Static, t } from "alepha";

/**
 * Vendor configuration atom.
 *
 * Filled from the `vendor` section of `alepha.config.ts`.
 * Read by `VendorCommand` to resolve remote, branch, and packages.
 */
export const vendorOptions = $atom({
  name: "alepha.cli.vendor.options",
  description: "Vendor synchronization configuration",
  schema: t.optional(
    t.object({
      /**
       * Git remote URL.
       *
       * @default "git@github.com:feunard/alepha.git"
       */
      remote: t.optional(t.text()),

      /**
       * Branch to sync from.
       */
      branch: t.text(),

      /**
       * Package directory names under `packages/` to sync.
       *
       * @example ["alepha", "@alepha/bucket-s3"]
       */
      packages: t.array(t.text()),
    }),
  ),
});

/**
 * Type for vendor options.
 */
export type VendorOptions = Static<typeof vendorOptions.schema>;
