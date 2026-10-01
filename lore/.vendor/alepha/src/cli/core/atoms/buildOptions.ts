import { $atom, type Infer, z } from "alepha";

/**
 * JavaScript runtime for the build output.
 *
 * - `node` - Node.js runtime (default)
 * - `bun` - Bun runtime (uses bun export conditions)
 * - `workerd` - Cloudflare Workers runtime (auto-set with cloudflare target)
 */
export type BuildRuntime = "node" | "bun" | "workerd";

/**
 * What `build.runtime` accepts in `alepha.config.ts`: one runtime, an ordered
 * list of them, or `static` for an app with no server at all.
 *
 * ⚠️ `static` is a DECLARATION, never a slice. It says the build produces no
 * server slice, so it can never appear in `runtimes`, which is the resolved
 * slice set.
 */
export type BuildRuntimeDeclaration =
  | BuildRuntime
  | "static"
  | Array<BuildRuntime | "static">;

/**
 * The declaration meaning "this app has no server".
 */
export const STATIC_RUNTIME = "static";

/**
 * Build options atom for CLI build command.
 *
 * Defines the available build configuration options with their defaults.
 * Options can be overridden via alepha.config.ts or CLI flags.
 */
export const buildOptions = $atom({
  name: "alepha.cli.build.options",
  description: "Build configuration options",
  schema: z.object({
    /**
     * Generate build stats report.
     *
     * - `true` - Generate a static HTML report
     * - `"json"` - Generate a JSON report
     */
    stats: z.union([z.boolean(), z.enum(["json"])]).optional(),

    /**
     * The runtime, or runtimes, the server is linked for.
     *
     * - `node` - Node.js (the default, and the universal floor: it runs under
     *   Bun too)
     * - `bun` - Bun export conditions; an optimization, never required
     * - `workerd` - Cloudflare Workers; mandatory and unavoidable for Cloudflare
     *
     * A list produces one server slice per runtime in ONE `dist/`, with the
     * client bundle, the prerender and the asset compression done exactly once:
     * `runtime: ["node", "workerd"]` covers Node hosts, Bun hosts and
     * Cloudflare from a single build.
     *
     * ## ⚠️ Order is meaningful
     *
     * The first declared runtime is the **primary**: it is `manifest.runtime`,
     * it is what `dist/package.json`'s `main` points at, and it is what a
     * deployer spawns. `["bun", "node"]` and `["node", "bun"]` produce the same
     * two slices and different behaviour.
     *
     * `--runtime node,workerd` overrides this. The config declares what the app
     * needs; the flag is for a caller that knows better.
     *
     * ## `static` is the fourth answer: no server at all
     *
     * `runtime: ["static"]` declares an app with nothing to spawn — a
     * prerendered client, served from disk. It produces no server slice, and
     * the manifest records it in the same field, where `static` has always
     * meant "nothing to do, serve the files".
     *
     * ⚠️ It is a slight abuse of the word, and the alternative was a
     * `static: true` beside this one. Decided here rather than in advance:
     * `build.static` ALREADY exists and holds the static site's own settings
     * (`domain`, `source`), so a boolean of the same name would be two
     * different things one keystroke apart. Reusing this field costs a small
     * stretch of "runtime" and introduces no new concept, and the manifest
     * had already made the same trade for the same reason.
     */
    runtime: z
      .union([
        z.enum(["node", "bun", "workerd", "static"]),
        z.array(z.enum(["node", "bun", "workerd", "static"])),
      ])
      .optional(),

    /**
     * The resolved, ordered slice set — written by `alepha build`, never by an
     * app.
     *
     * `runtime` above is the declaration and accepts a scalar or a list;
     * `BuildCommand` normalizes it here once, so no task has to re-merge the
     * flag with the config and arrive at its own answer. After resolution
     * `runtime` is the primary scalar and `runtimes[0]` is the same value, the
     * same relationship the build manifest carries.
     *
     * @internal
     */
    runtimes: z.array(z.enum(["node", "bun", "workerd"])).optional(),

    /**
     * Output directory configuration.
     */
    output: z
      .object({
        /**
         * Root dist directory.
         *
         * @default "dist"
         */
        dist: z.string().default("dist").optional(),

        /**
         * Public/client subdirectory.
         *
         * @default "public"
         */
        public: z.string().default("public").optional(),
      })
      .optional(),

    /**
     * SSR module preloading.
     */
    preload: z
      .object({
        /**
         * Source paths allowed to resolve to no chunks.
         *
         * A page whose preload key resolves to nothing ships no module
         * preloads at all, so the build refuses it by default and names the
         * path. List one here when the fold is deliberate and the cost is
         * understood.
         *
         * @example allowUnresolved: ["src/pages/Rare.tsx"]
         */
        allowUnresolved: z.array(z.string()).optional(),
      })
      .optional(),

    /**
     * Cloudflare-specific deployment configuration.
     *
     * Note: declaring a `workerd` runtime is what enables the Cloudflare
     * deploy config. This object is only for additional configuration.
     */
    cloudflare: z
      .object({
        config: z.json().optional(),
      })
      .optional(),

    /**
     * Infer site deployment configuration.
     *
     * Note: `runtime: ["static"]` is what enables static site generation.
     * This object is only for additional configuration.
     */
    static: z
      .object({
        /**
         * Surge domain for deployment.
         *
         * If set, a CNAME file is written to dist/public/.
         * If not set, a domain is auto-generated from package.json name.
         *
         * @example "my-app.surge.sh"
         * @example "my-custom-domain.com"
         */
        domain: z.string().optional(),

        /**
         * Directory holding a client the workspace built itself, copied into
         * `dist/<public>` before the static site is assembled.
         *
         * Without it this target can only ship what Alepha rendered — its own
         * Vite client build, or a `$page` at `/`. That leaves out every site
         * built by something else: a hand-written `index.html` through plain
         * Vite, an Astro export, a docs generator. Bay can host a site with no
         * process behind it; this is what lets one be produced.
         *
         * **Must live outside `dist/`.** The build cleans `dist/` before any
         * task runs, so a client written there is deleted before it can be
         * adopted — pointing at `dist/public` is refused by name rather than
         * failing later as a missing file.
         *
         * A server entry is still required (the build boots the workspace to
         * analyze it), even though nothing of it ships: `cleanDist` keeps only
         * the client directory and the manifest.
         *
         * @example "dist-client"
         */
        source: z.string().optional(),
      })
      .optional(),

    /**
     * PWA (Progressive Web App) configuration.
     *
     * Generates a web app manifest and enables installability.
     * Requires a client-side bundle (React).
     */
    pwa: z
      .object({
        /**
         * Full application name displayed on the splash screen
         * and in the OS app switcher.
         */
        name: z.string(),

        /**
         * Short name displayed on the home screen icon.
         * Falls back to `name` if omitted.
         */
        shortName: z.string().optional(),

        /**
         * Theme color used for the browser toolbar and OS chrome.
         *
         * @default "#ffffff"
         */
        themeColor: z.string().optional(),

        /**
         * Background color for the splash screen.
         *
         * @default "#ffffff"
         */
        backgroundColor: z.string().optional(),

        /**
         * Display mode for the installed PWA.
         *
         * - `standalone` - Looks like a native app (default)
         * - `fullscreen` - Uses entire screen (games, immersive)
         * - `minimal-ui` - Like standalone with minimal browser UI
         * - `browser` - Standard browser tab
         *
         * @default "standalone"
         */
        display: z
          .enum(["standalone", "fullscreen", "minimal-ui", "browser"])
          .optional(),
      })
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

/**
 * Type for build options.
 */
export type BuildOptions = Infer<typeof buildOptions.schema>;
