import { $atom, z } from "alepha";

/**
 * Schema for the embedded static files atom.
 */
export const staticEmbeddedAtomSchema = z.object({
  /**
   * When the binary was built, in epoch milliseconds. It is the modification
   * time of every embedded file, so ETag and Last-Modified stay the same
   * across restarts of one binary and change with every build.
   */
  builtAt: z.number().optional(),

  /**
   * The URL path of each embedded file (`/entry.js`), mapped to the path Bun
   * gave its copy inside the binary (`/$bunfs/root/...`).
   */
  files: z.record(z.string(), z.string()).optional(),
});

/**
 * Type for the embedded static files schema.
 */
export type StaticEmbeddedAtomSchema = typeof staticEmbeddedAtomSchema;

/**
 * The `public/` directory a `bun build --compile` binary carries inside
 * itself.
 *
 * Filled by the build's generated `index.js` (`__alepha.set(...)`) before the
 * app boots, the way the SSR manifest is, and read by the React server to
 * serve those files instead of the disk. Empty everywhere else.
 */
export const staticEmbeddedAtom = $atom({
  name: "alepha.server.static.embedded",
  description: "Static files embedded in a compiled binary",
  schema: staticEmbeddedAtomSchema,
  default: {},
  serverOnly: true,
});
