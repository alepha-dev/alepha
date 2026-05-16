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
       *
       * @default "main"
       */
      branch: t.optional(t.text()),

      /**
       * Parent directory holding the packages, on both the remote and the
       * local project. Relative to the repo / project root.
       *
       * @default "packages"
       */
      dir: t.optional(t.text()),

      /**
       * Package directory names under `dir` to sync.
       *
       * @example ["alepha", "@alepha/payments-stripe"]
       */
      packages: t.array(t.text()),
    }),
  ),
});

/**
 * Type for vendor options.
 */
export type VendorOptions = Static<typeof vendorOptions.schema>;
