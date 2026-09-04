import { $atom, z } from "alepha";

/**
 * Schema for the SSR manifest atom.
 */
export const ssrManifestAtomSchema = z.object({
  /**
   * The precomputed preload table.
   *
   * `files` is the deduplicated href list, with the asset base already
   * applied; everything else indexes into it. `keys` maps a page's preload
   * key to its module's full static closure, and `entry` carries the entry
   * point's script, stylesheets and own graph.
   *
   * Resolved by the build, because nothing in it depends on the request: the
   * head fragment of a route is a build-time constant. The client manifest it
   * is computed from used to be embedded here instead, 106 KB of it, so the
   * server could walk the same graph again on every request.
   */
  preload: z
    .object({
      files: z.array(z.string()),
      keys: z.record(z.string(), z.array(z.number())),
      entry: z
        .object({
          js: z.number().optional(),
          css: z.array(z.number()),
          graph: z.array(z.number()),
        })
        .optional(),
    })
    .optional(),

  /**
   * Dev mode head content.
   * Contains pre-transformed scripts injected by Vite and plugins (React, etc.).
   * Only set in dev mode via ViteDevServerProvider.
   */
  devHead: z.string().optional(),

  /**
   * Auto-detected favicon path and MIME type.
   * Format: "type:path" (e.g., "image/svg+xml:/favicon.svg").
   * Set at build/dev time by scanning the public directory.
   */
  favicon: z.string().optional(),
});

/**
 * Type for the SSR manifest schema.
 */
export type SsrManifestAtomSchema = typeof ssrManifestAtomSchema;

/**
 * SSR Manifest atom containing all manifest data for SSR module preloading.
 *
 * This atom is populated at build time by embedding manifest data into the
 * generated index.js. This approach is optimal for serverless deployments
 * as it eliminates filesystem reads at runtime.
 */
export const ssrManifestAtom = $atom({
  name: "alepha.react.ssr.manifest",
  description: "SSR manifest for module preloading",
  schema: ssrManifestAtomSchema,
  default: {},
  serverOnly: true,
});
