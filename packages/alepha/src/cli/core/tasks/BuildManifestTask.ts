import { basename } from "node:path";
import { $inject } from "alepha";
import { SEND_EMAIL_DEFAULT_BINDING } from "alepha/email/cloudflare";
import { FileSystemProvider } from "alepha/system";
import type { BuildManifest } from "../schemas/buildManifest.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

// Looked up by class name string (not by class identity) because build tasks
// run in the CLI's Alepha context while ctx.alepha is the workspace's separate
// context. Two module graphs = two distinct `CloudflareEmailProvider` class
// objects, so an imported reference here wouldn't match the one the workspace
// registered.
const CLOUDFLARE_EMAIL_PROVIDER_NAME = "CloudflareEmailProvider";

/**
 * Write `dist/manifest.json` — a build-time snapshot of everything downstream
 * tooling needs to know about the app without re-booting it.
 *
 * Runs for **every** target, not just Cloudflare. The manifest describes the
 * app, not the destination: which resources it declares, which crons it
 * registers, which runtime it was built for. Every deploy consumer needs the
 * same answers — `alepha platform up --prebuilt`, Alepha Rocket and Alepha Bay
 * alike — and a self-hosted deployer has no `package.json` in the artifact to
 * fall back on.
 *
 * It used to live inside `BuildCloudflareTask`, which meant a bare or
 * docker-targeted build silently produced no manifest at all, and anything
 * consuming the artifact had to be handed the same facts a second time by
 * hand. A hand-written manifest is exactly the code↔infra drift the derived
 * one exists to make impossible.
 */
export class BuildManifestTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);

  async run(ctx: BuildTaskContext): Promise<void> {
    // Prebuilt mode re-reads an existing manifest and would only rewrite the
    // same data. Keeping the original is what makes it the canonical record of
    // how the artifact was actually built.
    if (ctx.manifest) {
      return;
    }
    const distDir = ctx.options.output?.dist ?? "dist";
    await ctx.run({
      name: "write manifest",
      handler: async () => {
        await this.writeManifest(ctx, distDir);
      },
    });
  }

  /**
   * Resolve the runtime major to record in the manifest.
   *
   * A bare major only, never an exact version: pinning `26.1.0` would mean a
   * runtime security patch cannot be picked up without rebuilding and
   * redeploying every app.
   *
   * `engines` is the declared intent and wins. Falling back to the major of
   * the process that ran the build is the honest second answer — it is the
   * runtime the bundle's export conditions and syntax level were resolved
   * against.
   */
  protected async resolveRuntimeVersion(
    root: string,
    runtime: "node" | "bun" | "workerd",
  ): Promise<string | undefined> {
    // workerd has no user-visible version to pin — Cloudflare picks it via
    // `compatibility_date`.
    if (runtime === "workerd") {
      return undefined;
    }
    try {
      const pkg = await this.fs.readJsonFile<{
        engines?: Record<string, string>;
      }>(this.fs.join(root, "package.json"));
      const declared = pkg.engines?.[runtime];
      // Accept the usual range syntaxes (`>=26`, `^26.1.0`, `26.x`) and keep
      // only the leading major.
      const major = declared?.match(/(\d+)/)?.[1];
      if (major) {
        return major;
      }
    } catch {}
    if (runtime === "node") {
      return process.versions.node.split(".")[0];
    }
    // Bun exposes its version the same way when the build runs under Bun; a
    // node-run build targeting bun simply has nothing to say.
    return (process.versions as Record<string, string>).bun?.split(".")[0];
  }

  protected async writeManifest(
    ctx: BuildTaskContext,
    distDir: string,
  ): Promise<void> {
    const root = ctx.root;
    // Slugified basename, matching what BuildCloudflareTask uses for the
    // wrangler placeholder name so the manifest keeps reporting the same
    // project identity it always has.
    const name = basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);

    // Discover the same primitive shapes the Cloudflare enhance* methods read.
    // Errors are silently swallowed — an absent primitive class just
    // means the app doesn't use that resource.
    let hasDatabase = false;
    let hasBucket = false;
    let hasAnalytics = false;
    let hasKV = false;
    let hasQueue = false;
    let crons: string[] = [];

    try {
      const repo = ctx.alepha.inject("RepositoryProvider") as {
        getRepositories?: () => unknown[];
      };
      hasDatabase = (repo.getRepositories?.() ?? []).length > 0;
    } catch {}

    try {
      hasBucket = ctx.alepha.primitives("$storage").length > 0;
    } catch {}

    // `$storage` is the usual signal, but it is not the only supported way
    // to use object storage: `alepha/bucket` documents injecting
    // `FileStorageProvider` directly for "blobs without a database", and
    // that route declares no primitive.
    //
    // It cannot be detected from here either. The build introspects the
    // app under **node**, where `alepha/bucket` binds Local/Memory/S3; the
    // R2 binding — and its hard `R2_BUCKET_NAME` requirement — only exists
    // in the **workerd** variant. So nothing observable at build time says
    // "this app will need R2 at runtime".
    //
    // The result was a worker that built and uploaded but could not boot,
    // rejected by Cloudflare with a bare
    // `SchemaValidationError: 'R2_BUCKET_NAME' is required`.
    //
    // Setting `R2_BUCKET_NAME` yourself is therefore a first-class way to
    // declare the need. It provisions the bucket and emits the binding
    // exactly as `$storage` would.
    if (!hasBucket && process.env.R2_BUCKET_NAME) {
      hasBucket = true;
    }

    try {
      hasAnalytics = ctx.alepha.primitives("$analytics").length > 0;
    } catch {}

    // Same escape hatch as R2 above, for the same reason: an app can want
    // the dataset provisioned without a `$analytics` primitive to detect —
    // typically because `CLOUDFLARE_ANALYTICS_DATASET` is already set by
    // hand from before this mechanism existed. There is no equivalent to
    // R2's "inject the provider directly" route here (`WaeAnalyticsProvider`
    // is only ever selected internally, by `AlephaApiAnalytics`'s own
    // `register()`), but honoring an explicit value costs nothing and keeps
    // a hand-set `.env.production` working exactly as it did before.
    if (!hasAnalytics && process.env.CLOUDFLARE_ANALYTICS_DATASET) {
      hasAnalytics = true;
    }

    try {
      // Only count $cache primitives without an explicit `provider`
      // option — those fall back to KV on workerd. Explicit memory /
      // Redis / Postgres providers opt out of KV provisioning.
      hasKV =
        ctx.alepha
          .primitives("cache")
          .filter(
            (p) =>
              (p as { options?: { provider?: unknown } }).options?.provider ==
              null,
          ).length > 0;
    } catch {}

    try {
      // There is no queue primitive to count. A Queue binding is needed only
      // when `$job` dispatch is routed through a broker, which is exactly
      // what registering `JobQueueProvider` (via `AlephaApiJobsQueue`) means.
      hasQueue = !!ctx.alepha.inject("JobQueueProvider");
    } catch {}

    let hasWebSocket = false;
    let websocketPaths: string[] = [];
    try {
      // Union of both realtime primitives: a `$room` rides the same worker
      // upgrade branch and the same `AlephaWebSocketDurableObject` as a
      // `$websocket`, so a rooms-only app must still record its channel
      // paths — otherwise the `--prebuilt` deploy path emits a worker with
      // no WebSocket wiring. Dedup'd: a `$room` may share its `$channel`
      // path with a `$websocket`.
      const realtimePrimitives = [
        ...ctx.alepha.primitives("$websocket"),
        ...ctx.alepha.primitives("$room"),
      ];
      websocketPaths = [
        ...new Set(
          realtimePrimitives.map((p: any) => p.options.channel.options.path),
        ),
      ];
      hasWebSocket = websocketPaths.length > 0;
    } catch {}

    try {
      const cronProvider = ctx.alepha.inject("CronProvider") as {
        getCronJobs?: () => Array<{ expression: string }>;
      };
      crons = [
        ...new Set(
          (cronProvider.getCronJobs?.() ?? []).map((c) => c.expression),
        ),
      ];
    } catch {}

    // platformOptions come from the CLI's Alepha instance (where
    // alepha.config.ts ran during the configure hook). BuildCommand
    // reads them up there and threads them via ctx — ctx.alepha here
    // is the WORKSPACE's Vite-booted Alepha, which never saw the
    // platform options.
    const defaultEnv = ctx.platformOptions?.default ?? "production";
    const environments = (ctx.platformOptions?.environments ??
      {}) as BuildManifest["environments"];

    // Every declared `$env` key. dump() force-instantiates the graph (no
    // start/ready hooks), so this is the full env surface — used by the
    // deploy `secrets` step as the worker-secret allowlist.
    let env: string[] = [];
    let publicVars: string[] | undefined;
    try {
      const dumped = ctx.alepha.dump().env;
      env = Object.keys(dumped).sort();
      // Only the declassified keys are recorded: everything else on `env` is a
      // secret, so a companion `secrets` list would just be the complement, and
      // two lists obliged to agree eventually don't. Left undefined rather than
      // `[]` so "never annotated" stays legible in the artifact.
      const declassified = env.filter((key) => dumped[key]?.secret === false);
      publicVars = declassified.length ? declassified : undefined;
    } catch {}

    /*
      ⚠️ The env surface above is the graph as instantiated HERE — under node.
      A key declared only by a provider that exists only on workerd is
      therefore absent from it, and since this list is the allowlist the
      deploy `secrets` step pushes from, such a key can never reach the
      worker. The operator sets it in `.env.production`, `platform up` reports
      success, and the worker boots without it.

      That is the same node-cannot-see-workerd hazard the bucket and dataset
      detection above document, one layer over: not a missing binding, a
      missing SECRET — and a missing secret fails at request time rather than
      at boot, so it surfaces as a broken feature rather than a failed deploy.
      It cost a production outage: `WaeAnalyticsProvider` declares
      `CLOUDFLARE_ANALYTICS_TOKEN`, is selected only under workerd, and every
      analytics read 500'd on a credential the deploy had quietly refused to
      push.

      Detection is the right fix because detection is the one thing that DOES
      work from node: `hasAnalytics` is already known above, and it is exactly
      the condition under which the runtime will demand these keys.
      `CLOUDFLARE_ANALYTICS_DATASET` is deliberately not added — the platform
      supplies it as a plain var and `EXCLUDED_SECRET_KEYS` drops it from
      every push.
    */
    if (hasAnalytics) {
      for (const key of ["CLOUDFLARE_ANALYTICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID"])
        if (!env.includes(key)) env.push(key);
      env.sort();
    }

    // Capture the CF email binding so manifest-mode deploys (Rocket) can
    // re-emit `send_email` — `enhanceEmail` can't introspect there.
    let email: BuildManifest["email"];
    try {
      ctx.alepha.inject(CLOUDFLARE_EMAIL_PROVIDER_NAME);
      email = { binding: SEND_EMAIL_DEFAULT_BINDING };
    } catch {}

    /*
      A static build has no entry point to spawn, and this field is what every
      deploy consumer switches on to decide what to do with the artifact —
      "nothing, serve the files" is a legitimate answer to that question.

      Recorded in `runtime` rather than as a new field precisely because a
      deployer that predates static hosting switches on THIS one: meeting an
      unknown value it refuses the deploy and names it. A separate field would
      be ignored — unknown fields are dropped on purpose so a newer build never
      breaks an older deployer — leaving it to read `runtime: node` and spawn a
      process against a directory with no entry point.
    */
    const isStatic = ctx.options.target === "static";
    const processRuntime = ctx.options.runtime ?? "node";

    const manifest: BuildManifest = {
      version: 1,
      project: name,
      defaultEnv,
      tenancy: ctx.platformOptions?.tenancy,
      environments,
      runtime: isStatic ? "static" : processRuntime,
      // No interpreter is resolved for a static site, so a version here would
      // be a claim about a process that does not exist.
      runtimeVersion: isStatic
        ? undefined
        : await this.resolveRuntimeVersion(root, processRuntime),
      entry: distDir,
      resources: {
        hasDatabase,
        hasBucket,
        hasAnalytics,
        hasKV,
        hasQueue,
        hasCron: crons.length > 0,
        hasWebSocket,
      },
      crons,
      websocketPaths,
      email,
      env,
      publicVars,
      cloudflareConfig: ctx.options.cloudflare?.config as
        | Record<string, unknown>
        | undefined,
    };

    // `writeFile` does not create parent directories. This used to be safe by
    // accident — the manifest was written from the Cloudflare task, which only
    // ever ran after the bundle steps had created `dist/`. Running for every
    // target means no such guarantee.
    await this.fs.mkdir(this.fs.join(root, distDir), { recursive: true });
    await this.fs.writeFile(
      this.fs.join(root, distDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  }
}
