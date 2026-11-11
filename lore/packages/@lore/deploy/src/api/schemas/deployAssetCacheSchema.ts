import { type Infer, z } from "alepha";

export const deployAssetCacheSchema = z.object({
  version: z.literal(2),
  sha256: z.text().regex(/^[a-f0-9]{64}$/),
  manifest: z.record(
    z.string(),
    z.object({
      hash: z.text().regex(/^[a-f0-9]{32}$/),
      size: z.number().int().nonnegative(),
      /**
       * The full SHA-256 of the asset's bytes, which an uploaded body is
       * checked against. Optional only for a list written before it was kept.
       */
      digest: z
        .text()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
  ),
  configTexts: z.object({
    _headers: z.string().optional(),
    _redirects: z.string().optional(),
  }),
  /**
   * Who computed the list: `deploy`, Lore itself from the archive's bytes, or
   * `push`, the pusher's CLI (#Q3381), which is the pusher's claim and is
   * stored per project.
   */
  source: z.enum(["deploy", "push"]).optional(),
  unpacked: z.object({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});

export type DeployAssetCacheEntry = Infer<typeof deployAssetCacheSchema>;
