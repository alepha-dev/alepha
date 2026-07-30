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
 */
export interface BuildManifest {
  version: 1;
  project: string;
  /**
   * Default environment when `--env` is omitted at deploy time.
   * Captured from `platformOptions.default` (defaults to `"production"`).
   */
  defaultEnv: string;
  /**
   * Multi-tenancy mode (`none` | `optional` | `required`). Captured from
   * `platformOptions.tenancy` so the prebuilt deploy side (Rocket) can
   * validate `--tenant` without re-evaluating `alepha.config.ts`.
   */
  tenancy?: "none" | "optional" | "required";
  /**
   * Resolved `platform({ environments: ... })` map. Captured at build
   * time from the workspace's `alepha.config.ts` so the deploy side
   * doesn't need to re-evaluate the config. Each value is the same
   * `EnvironmentConfig` shape consumed by the orchestrator (adapter,
   * domain, zone, jurisdiction, accountId).
   */
  environments: Record<
    string,
    {
      adapter: "cloudflare" | "vercel" | "bay";
      domain?: string;
      zone?: string;
      jurisdiction?: "eu" | "fedramp";
      accountId?: string;
    }
  >;
  /**
   * JavaScript runtime the artifact was built for (`node` | `bun` |
   * `workerd`).
   *
   * A self-hosted deployer has to pick an interpreter before it can start the
   * process, and the artifact carries no `package.json` to consult — so the
   * choice has to be recorded here at build time.
   *
   * Optional: artifacts built before this field existed don't carry it, and a
   * consumer should treat an absent value as `node`.
   *
   * TODO: surface this in `alepha.config.ts`'s `platform({ ... })` so a
   * workspace can declare its runtime rather than inheriting whatever
   * `--runtime` the build happened to use.
   */
  runtime?: "node" | "bun" | "workerd";
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
  runtimeVersion?: string;
  /**
   * Directory inside the artifact that the runtime should be pointed at,
   * relative to the archive root — normally `dist`, or whatever
   * `output.dist` was set to.
   *
   * `node dist` resolves `dist/index.js` via its `main`, so a deployer can
   * spawn `<runtime> <entry>` without knowing the bundle layout.
   *
   * Optional for the same reason as {@link runtime} — treat an absent value
   * as `dist`.
   */
  entry?: string;
  resources: {
    hasDatabase: boolean;
    hasBucket: boolean;
    hasKV: boolean;
    hasQueue: boolean;
    hasCron: boolean;
    hasWebSocket: boolean;
  };
  /**
   * All distinct cron expressions registered against `CronProvider` —
   * i.e. every `$job({ cron })`. Empty when `hasCron` is false.
   */
  crons: string[];
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
  websocketPaths: string[];
  /**
   * Cloudflare email binding, captured when the app registers
   * `CloudflareEmailProvider` at artifact-build time. The prebuilt/manifest
   * deploy path (Alepha Rocket `--prebuilt`) has no Vite introspection, so it
   * reads this to re-emit the `send_email` wrangler binding. Absent when the
   * app doesn't use Cloudflare email.
   */
  email?: { binding: string };
  /**
   * Every env var the app declares via `$env`, captured from
   * `alepha.dump().env` at build time. The deploy `secrets` step uses this
   * as the worker-secret allowlist (minus build/binding vars) so CI can
   * deliver secrets straight from `process.env` without a `.env` file —
   * `platform.secrets.keys` overrides it when set. Empty when introspection
   * was unavailable (older artifacts / prebuilt mode).
   */
  env: string[];
}
