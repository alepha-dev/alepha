import { Miniflare } from "miniflare";

/**
 * A throwaway `workerd` instance whose only purpose is to hand back a real D1
 * binding.
 *
 * Both D1 specs need the same thing — an in-memory D1 database, and a worker
 * that never handles a request — so the config lives here rather than twice.
 *
 * ⚠️ This is miniflare's native (v5) config shape, not the flat
 * `{ modules, script, d1Databases }` shorthand the specs used against v4. That
 * shorthand no longer validates: v5 rejects the top-level keys outright and
 * requires `workers: [...]`. Miniflare still ships
 * `convertV4MiniflareOptions()` to translate the old shape, but it is a
 * migration shim on its way out, so the config is written natively instead.
 *
 * The version is pinned to the exact one `wrangler` depends on. That is what
 * keeps a single `workerd` binary in the tree, and it means these tests run on
 * the same runtime build `wrangler dev` and a deploy use.
 */
export const d1Miniflare = (binding = "DB"): Miniflare =>
  new Miniflare({
    workers: [
      {
        config: {
          type: "worker",
          name: "d1-fixture",
          // Fixed, because nothing here is date-sensitive and a moving
          // compatibility date would make the fixture drift on its own.
          compatibilityDate: "2000-01-01",
          manifest: {
            mainModule: "index.mjs",
            modules: {
              "index.mjs": { type: "esm", contents: "export default {};" },
            },
          },
          env: { [binding]: { type: "d1", id: ":memory:" } },
        },
      },
    ],
  });
