import { type Infer, z } from "alepha";

/**
 * Build-time snapshot describing what the workspace needs at deploy time.
 * Written to `dist/manifest.json`.
 *
 * This is the artifact contract between `alepha build` and every deploy
 * consumer: `alepha platform up --prebuilt`, Lore Deploy, and Alepha Bay.
 * It exists so the deploy side never has to boot the app, re-evaluate
 * `alepha.config.ts`, or run the workspace's `npm install`: everything a
 * deployer needs to know is captured here, at build time, from the primitives
 * the app actually declares.
 *
 * That is what makes the manifest **derived rather than written**. Declaring
 * `$repository` is what puts `hasDatabase: true` in here, and a deployer
 * provisioning storage off the back of it cannot drift from the code the way a
 * hand-maintained compose file or Terraform variable does.
 *
 * Lives in its own file rather than beside the task that writes it: both
 * `BuildTask` (which carries it on the context) and `BuildManifestTask` (which
 * produces it) need the type, and importing it from the task would close a
 * cycle through `BuildTask`.
 *
 * ## ⚠️ Loose, and it has to stay loose
 *
 * `.loose()`, never a bare `z.object` and never `.strict()`. Unknown keys are
 * **kept**, in both directions, and each direction has its own reason:
 *
 * - Reading, refusing an unknown key would make a newer build unreadable by an
 *   older deployer. Every consumer drops fields it does not act on precisely
 *   so that cannot happen: Bay's `manifest.go` says so in its own struct
 *   comment, and Go's decoder behaves that way for free.
 * - Writing, a plain `z.object` would be worse than strict: it **strips**
 *   unknown keys silently, so parsing before writing would delete any field
 *   this schema had not caught up with. The validation would be quietly
 *   destroying the forward compatibility it exists to protect.
 *
 * The rule is therefore: adding a field here is safe, and every consumer is
 * free to ignore it. `resources` has seven fields in TypeScript and four in Go
 * for exactly that reason, and that is by design rather than drift.
 *
 * ## No version field
 *
 * There is no schema version (#Q2465). Compatibility is not kept across a
 * change of this contract: every producer and consumer moves in the same
 * commit, and an older artifact is rebuilt rather than read.
 */
export const buildManifestSchema = z
  .object({
    /**
     * The workspace's package name, which a deployer names resources after.
     */
    project: z.string(),
    /**
     * Every runtime this artifact can run on, **in declared order**. The one
     * place a manifest says what a deployer must do with it.
     *
     * One entry per slice the build produced. A server slice names the runtime
     * it was linked for (`node`, `bun`, `workerd`) and the file to spawn, and
     * the archive holds its `server/<runtime>/` chunks beside one
     * `index.<runtime>.js` per slice. A static build is one `static` slice with
     * no entry: nothing is spawned, the files are served.
     *
     * There is no `index.js` that sniffs its host, and no scalar `runtime` /
     * `entry` pair beside this list any more (#Q2460): a second mechanism able
     * to disagree with this one is worse than none. Required and never empty,
     * so a consumer has one path, not a fallback.
     *
     * ## ⚠️ Order is meaningful and no consumer may sort it
     *
     * The first entry is the primary. It is what `dist/package.json`'s `main`
     * points at and what `alepha image` packages. A deployer takes the FIRST
     * slice it can run, applying no preference of its own: `["node", "bun"]`
     * spawns node and `["bun", "node"]` spawns bun, from the same two slices.
     * Reordering this array here, or in any consumer, silently changes which
     * runtime an app is deployed on.
     */
    runtimes: z
      .array(
        z
          .object({
            /**
             * The runtime this slice was linked for, or `static` for a build
             * that spawns nothing.
             */
            runtime: z.enum(["node", "bun", "workerd", "static"]),
            /**
             * The file to spawn for this slice, relative to the archive root
             * (e.g. `index.node.js`). Absent on a `static` slice.
             */
            entry: z.string().optional(),
            /**
             * Major version of the runtime, as a bare major (`"26"`), or
             * absent when unknown or meaningless (`workerd`, `static`).
             *
             * Per slice because a node slice and a bun slice need different
             * majors. Deliberately **only a major**, never an exact version:
             * pinning `26.1.0` means a security patch in the runtime cannot be
             * picked up without rebuilding and redeploying every app, which is
             * precisely the problem a separately-managed runtime solves.
             *
             * Read from the workspace's `engines.node` / `engines.bun` when
             * declared, otherwise from the major of the runtime that ran the
             * build.
             */
            runtimeVersion: z.string().optional(),
          })
          .loose(),
      )
      .min(1),
    resources: z
      .object({
        hasDatabase: z.boolean(),
        hasBucket: z.boolean(),
        hasAnalytics: z.boolean(),
        hasKV: z.boolean(),
        hasQueue: z.boolean(),
        hasCron: z.boolean(),
        hasWebSocket: z.boolean(),
      })
      .loose(),
    /**
     * All distinct cron expressions registered against `CronProvider`, i.e.
     * every `$job({ cron })`. Empty when `hasCron` is false.
     *
     * Every deploy target reads it: Bay schedules from it, a Worker gets one
     * trigger per expression, and Lore's estate inventory counts it.
     */
    crons: z.array(z.string()),
    /**
     * Every `$env` key the app declares that is a SECRET: encrypted at rest,
     * never shown back, delivered to the runtime as a secret.
     *
     * A key is a secret unless its schema says `secret: false`, so this is
     * everything not in {@link variables}. The two lists are DISJOINT: each
     * key the app declares lands in exactly one (#Q2465). A deploy target
     * sends a key in plaintext only if it is in `variables`, which is the
     * direction that fails safe.
     *
     * The deploy's secrets step uses it as the allowlist it pushes from, minus
     * the names the deploy binds itself.
     */
    secrets: z.array(
      z
        .object({
          name: z.string(),
          /**
           * The `$env` schema's own description, when it declared one.
           */
          description: z.string().optional(),
        })
        .loose(),
    ),
    /**
     * Every `$env` key the app declared `secret: false`: a value an author
     * vouched for as safe in plaintext, which a deploy target may ship as a
     * plain binding and a UI may show. Disjoint from {@link secrets}.
     */
    variables: z.array(
      z
        .object({
          name: z.string(),
          /**
           * The `$env` schema's own description, when it declared one.
           */
          description: z.string().optional(),
        })
        .loose(),
    ),
    /**
     * What only a Worker deploy needs. Present when the build carries a
     * `workerd` slice, absent otherwise.
     *
     * Lore Deploy regenerates `wrangler.jsonc` and the worker entry from the
     * manifest alone (`PlatformOrchestrator.up({ prebuilt: true })` inside its
     * own Worker), with no app to introspect, so everything that regeneration
     * cannot derive is captured here at build time.
     */
    cloudflare: z
      .object({
        /**
         * The raw `build.cloudflare.config` from the app's `alepha.config.ts`.
         *
         * The prebuilt deploy regenerates `wrangler.jsonc` without loading the
         * workspace's config, so anything the author wrote there was silently
         * dropped at deploy: `assets.run_worker_first` and
         * `not_found_handling` were in the built artifact, absent from the
         * deployed worker. Absent when the app declares no Cloudflare config.
         */
        config: z.record(z.string(), z.any()).optional(),
        /**
         * Registered `$websocket` channel paths (e.g. `/ws/chat`).
         *
         * On Workers a WebSocket is held by a Durable Object, and the
         * generated worker entry routes an upgrade to it by path before the
         * app boots. Without this list the entry's guard stays empty and
         * upgrades silently fail to route, though the binding is emitted.
         * Empty when `resources.hasWebSocket` is false.
         */
        websocketPaths: z.array(z.string()),
        /**
         * The `send_email` binding, captured when the app registers
         * `CloudflareEmailProvider`. Absent when it does not.
         */
        email: z.object({ binding: z.string() }).loose().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/**
 * One source for the shape: the type is derived from the schema, never
 * declared beside it.
 */
export type BuildManifest = Infer<typeof buildManifestSchema>;
