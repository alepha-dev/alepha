import { $atom, type Static, z } from "alepha";

/**
 * Vendor configuration atom.
 *
 * Filled from the `vendor` section of `alepha.config.ts`.
 * Read by `VendorCommand` to resolve remote, branch, and packages.
 */
export const vendorOptions = $atom({
  name: "alepha.cli.vendor.options",
  description: "Vendor synchronization configuration",
  schema: z
    .object({
      /**
       * Git remote URL.
       *
       * @default "https://github.com/feunard/alepha"
       */
      remote: z.text().optional(),

      /**
       * Branch to sync from.
       *
       * @default "main"
       */
      branch: z.text().optional(),

      /**
       * Parent directory holding the vendored packages in the local project.
       * Relative to the project root. Also where the `vendor.json` lock file
       * is written. The remote is always expected to lay its packages out
       * under `packages/`.
       *
       * @default ".vendor"
       */
      dir: z.text().optional(),

      /**
       * Package directory names under `dir` to sync.
       *
       * @example ["alepha", "@alepha/payments-stripe"]
       */
      packages: z.array(z.text()),
    })
    .optional(),
  serverOnly: true,
});

/**
 * Type for vendor options.
 */
export type VendorOptions = Static<typeof vendorOptions.schema>;
