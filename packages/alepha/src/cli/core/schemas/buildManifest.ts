import { type Infer, z } from "alepha";

/**
 * Build-time snapshot describing what the workspace needs at deploy time.
 * Written to `dist/manifest.json`.
 *
 * This is the artifact contract between `alepha build` and every deploy
 * consumer — `alepha platform up --prebuilt`, Alepha Rocket, and Alepha Bay.
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
 *   so that cannot happen — Bay's `manifest.go` says so in its own struct
 *   comment, and Go's decoder behaves that way for free.
 * - Writing, a plain `z.object` would be worse than strict: it **strips**
 *   unknown keys silently, so parsing before writing would delete any field
 *   this schema had not caught up with. The validation would be quietly
 *   destroying the forward compatibility it exists to protect.
 *
 * The rule is therefore: adding a field here is safe, and every consumer is
 * free to ignore it. `resources` has six fields in TypeScript and four in Go
 * for exactly that reason, and that is by design rather than drift.
 */
export const buildManifestSchema = z
  .object({
    version: z.literal(1),
    project: z.string(),
    /**
     * Default environment when `--env` is omitted at deploy time.
     * Captured from `platformOptions.default` (defaults to `"production"`).
     */
    defaultEnv: z.string(),
    /**
     * Multi-tenancy mode (`none` | `optional` | `required`). Captured from
     * `platformOptions.tenancy` so the prebuilt deploy side (Rocket) can
     * validate `--tenant` without re-evaluating `alepha.config.ts`.
     */
    tenancy: z.enum(["none", "optional", "required"]).optional(),
    /**
     * Resolved `platform({ environments: ... })` map. Captured at build
     * time from the workspace's `alepha.config.ts` so the deploy side
     * doesn't need to re-evaluate the config. Each value is the same
     * `EnvironmentConfig` shape consumed by the orchestrator (adapter,
     * domain, zone, jurisdiction, accountId).
     */
    environments: z.record(
      z.string(),
      z
        .object({
          adapter: z.enum(["cloudflare", "bay"]),
          domain: z.string().optional(),
          zone: z.string().optional(),
          jurisdiction: z.enum(["eu", "fedramp"]).optional(),
          accountId: z.string().optional(),
        })
        .loose(),
    ),
    /**
     * What a deployer must do to run this artifact (`node` | `bun` | `workerd` |
     * `static`).
     *
     * Three of the four name a JavaScript runtime: a self-hosted deployer has to
     * pick an interpreter before it can start the process, and the artifact
     * carries no `package.json` to consult, so the choice is recorded here at
     * build time.
     *
     * `static` is the fourth answer — "nothing, serve the files". A
     * `--target=static` build has no entry point to spawn at all.
     *
     * It lives in this field rather than in a `kind` of its own **because of what
     * an older deployer does with it**. Every deployer already switches on
     * `runtime`, so an unknown value is refused by name at deploy time. A new
     * field would instead be *ignored* — consumers drop fields they do not know
     * so that a newer build never breaks an older deployer — leaving one to read
     * `runtime: node`, spawn a process against a directory with no entry point,
     * and report only "never became ready".
     *
     * Optional: artifacts built before this field existed don't carry it, and a
     * consumer should treat an absent value as `node`.
     *
     * TODO: surface this in `alepha.config.ts`'s `platform({ ... })` so a
     * workspace can declare its runtime rather than inheriting whatever
     * `--runtime` the build happened to use.
     */
    runtime: z.enum(["node", "bun", "workerd", "static"]).optional(),
    /**
     * Major version of the runtime, as a bare major (`"26"`), or absent when
     * unknown.
     *
     * Deliberately **only a major**, never an exact version. Pinning
     * `26.1.0` means a security patch in the runtime cannot be picked up
     * without rebuilding and redeploying every app — which is precisely the
     * problem a separately-managed runtime is supposed to solve.
     *
     * Read from the workspace's `engines.node` / `engines.bun` when declared,
     * otherwise from the major of the runtime that ran the build.
     */
    runtimeVersion: z.string().optional(),
    /**
     * Directory inside the artifact that the runtime should be pointed at,
     * relative to the archive root — normally `dist`, or whatever
     * `output.dist` was set to.
     *
     * `node dist` resolves `dist/index.js` via its `main`, so a deployer can
     * spawn `<runtime> <entry>` without knowing the bundle layout.
     *
     * Optional for the same reason as `runtime` — treat an absent value
     * as `dist`.
     */
    entry: z.string().optional(),
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
     * All distinct cron expressions registered against `CronProvider` —
     * i.e. every `$job({ cron })`. Empty when `hasCron` is false.
     */
    crons: z.array(z.string()),
    /**
     * Every registered `$job` and its declared `timeout`, in milliseconds.
     *
     * Read by `BuildCloudflareTask` to warn about timeouts direct mode cannot
     * honour on Workers. Optional because a manifest written before this field
     * existed is still a valid manifest: absent means "nothing to check", not
     * "no jobs".
     */
    jobs: z
      .array(
        z
          .object({
            name: z.string(),
            timeoutMs: z.number().optional(),
          })
          .loose(),
      )
      .optional(),
    /**
     * Registered `$websocket` channel paths (e.g. `/ws/chat`), captured the
     * same way `writeWorkerEntryPoint`'s live-probe path resolves
     * `websocketPaths` (`ctx.alepha.primitives("$websocket")` mapped to
     * `options.channel.options.path`). The prebuilt/manifest deploy path
     * (Alepha Rocket `--prebuilt`) has no live Alepha to introspect, so
     * without this the emitted worker's `wsPaths` guard stays empty and
     * WebSocket upgrades silently fail to route even though the DO binding
     * and migration are still emitted. Empty when `resources.hasWebSocket`
     * is false.
     */
    websocketPaths: z.array(z.string()),
    /**
     * Cloudflare email binding, captured when the app registers
     * `CloudflareEmailProvider` at artifact-build time. The prebuilt/manifest
     * deploy path (Alepha Rocket `--prebuilt`) has no Vite introspection, so it
     * reads this to re-emit the `send_email` wrangler binding. Absent when the
     * app doesn't use Cloudflare email.
     */
    email: z.object({ binding: z.string() }).loose().optional(),
    /**
     * Every env var the app declares via `$env`, captured from
     * `alepha.dump().env` at build time. The deploy `secrets` step uses this
     * as the worker-secret allowlist (minus build/binding vars) so CI can
     * deliver secrets straight from `process.env` without a `.env` file —
     * `platform.secrets.keys` overrides it when set. Empty when introspection
     * was unavailable (older artifacts / prebuilt mode).
     */
    env: z.array(z.string()),
    /**
     * The subset of `env` whose schema declared `secret: false` — keys an
     * author explicitly vouched for as safe in plaintext.
     *
     * **Everything on `env` and not on this list is a secret.** There is no
     * companion `secrets` field on purpose: it would be the exact complement of
     * this one, and two lists obliged to agree eventually stop agreeing. Which
     * one a deploy target then trusts decides whether a key ships encrypted.
     *
     * A deploy target may downgrade a key to a plaintext binding only if it
     * appears here. Absent — never `[]` — when the app declassified nothing, so
     * an artifact from an app that never annotated anything stays legible as
     * such.
     */
    publicVars: z.array(z.string()).optional(),
    /**
     * The raw `build.cloudflare.config` from the app's `alepha.config.ts`,
     * captured at artifact-build time.
     *
     * The prebuilt/manifest deploy path regenerates `wrangler.jsonc` without
     * loading the workspace's config, so anything the author wrote there was
     * silently dropped at deploy — the build produced a correct file and the
     * deploy overwrote it with the defaults. Nothing failed, which is what made
     * it expensive: `assets.run_worker_first` and `not_found_handling` were in
     * the built artifact, absent from the deployed worker, and the only symptom
     * was the behaviour they were meant to fix still happening in production.
     *
     * Absent when the app declares no Cloudflare config.
     */
    cloudflareConfig: z.record(z.string(), z.any()).optional(),
  })
  .loose();

/**
 * One source for the shape: the type is derived from the schema, never
 * declared beside it.
 */
export type BuildManifest = Infer<typeof buildManifestSchema>;
