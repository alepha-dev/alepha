import { type Infer, z } from "alepha";

/**
 * The asset list a push carries beside its archive (#Q3381): every file under
 * the build's `public/`, as the pusher's CLI computed it.
 *
 * ⚠️ **The pusher's claim, never a fact.** Cloudflare does not verify an asset
 * key, so a list that lies can only break the pusher's own app, and the deploy
 * checks every body it uploads against the digest listed here. It is stored
 * per project, so a list pushed in one project never steers a deploy in
 * another, even of the same bytes.
 *
 * A wire contract with `@alepha/lore`'s `ArtifactAssetLister`, which writes
 * it. Bounded: an entry per asset, ~150 bytes each, so 4 MB is ~25,000 assets.
 */
export const artifactAssetListSchema = z.object({
  version: z.literal(1),
  assets: z
    .array(
      z.object({
        /**
         * The served path, `/assets/app.js`.
         */
        path: z.string().min(2).max(1024).regex(/^\//),
        /**
         * The full SHA-256 of the raw bytes.
         */
        sha256: z.text().regex(/^[a-f0-9]{64}$/),
        size: z.number().int().nonnegative(),
        contentType: z.string().max(200),
      }),
    )
    .max(20_000),
  config: z.object({
    _headers: z
      .string()
      .max(1024 * 1024)
      .optional(),
    _redirects: z
      .string()
      .max(1024 * 1024)
      .optional(),
  }),
});

export type ArtifactAssetList = Infer<typeof artifactAssetListSchema>;
