import { type Infer, z } from "alepha";

export const deployAssetCacheSchema = z.object({
  version: z.literal(1),
  sha256: z.text().regex(/^[a-f0-9]{64}$/),
  manifest: z.record(
    z.string(),
    z.object({
      hash: z.text().regex(/^[a-f0-9]{32}$/),
      size: z.number().int().nonnegative(),
    }),
  ),
  configTexts: z.object({
    _headers: z.string().optional(),
    _redirects: z.string().optional(),
  }),
  unpacked: z.object({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});

export type DeployAssetCacheEntry = Infer<typeof deployAssetCacheSchema>;
