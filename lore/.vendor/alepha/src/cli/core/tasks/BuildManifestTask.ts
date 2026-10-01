import { $inject } from "alepha";
import { SEND_EMAIL_DEFAULT_BINDING } from "alepha/email/cloudflare";
import { FileSystemProvider } from "alepha/system";

import {
  type BuildManifest,
  buildManifestSchema,
} from "../schemas/buildManifest.ts";
import { BuildSlices } from "../services/BuildSlices.ts";
import { MetaResolver } from "../services/MetaResolver.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

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
  // Looked up by class name string (not by class identity) because build tasks
  // run in the CLI's Alepha context while ctx.alepha is the workspace's separate
  // context. Two module graphs = two distinct `CloudflareEmailProvider` class
  // objects, so an imported reference here wouldn't match the one the workspace
  // registered.
  protected readonly cloudflareEmailProviderName = "CloudflareEmailProvider";

  protected readonly fs = $inject(FileSystemProvider);
  protected readonly meta = $inject(MetaResolver);
  protected readonly slices = $inject(BuildSlices);

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
    //
    // Shared with MetaResolver rather than repeated, because `alepha.meta.name`
    // promises to BE this string: an operator comparing `/version` against a
    // deploy target has to be comparing the same slug, and two copies of the
    // rule would eventually stop agreeing without anything failing.
    const name = this.meta.slug(root);

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
      // ⚠️ **A `$cache` with no explicit provider no longer implies KV.**
      // Since #Q2151 the workerd default is `CloudflareCacheProvider`, which
      // picks the database cache whenever the container has one, so an app
      // that registered `alepha/cache/database` needs no KV namespace at all
      // and used to get one provisioned that nothing ever wrote to.
      //
      // Asked by NAME for the same reason the provider itself does it: the
      // CLI must not import `alepha/cache/database` to answer a question
      // about somebody else's container. `inject` throws when nothing
      // answers, which is the ordinary no-database-cache case.
      let hasDatabaseCache = false;
      try {
        hasDatabaseCache = !!ctx.alepha.inject("DatabaseCacheProvider");
      } catch {}

      // Explicit memory / Redis / database providers opt out either way.
      hasKV =
        !hasDatabaseCache &&
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

    // Every declared `$env` key, split into what is a secret and what the
    // author declared `secret: false` (#Q2465). dump() force-instantiates the
    // graph (no start/ready hooks), so this is the full env surface. The two
    // lists are disjoint: each key lands in exactly one, and "nobody said"
    // means secret.
    type EnvEntry = BuildManifest["secrets"][number];
    const envEntries = new Map<string, EnvEntry & { secret: boolean }>();
    try {
      const dumped = ctx.alepha.dump().env;
      for (const [key, variable] of Object.entries(dumped)) {
        envEntries.set(key, {
          name: key,
          description: variable.description,
          secret: variable.secret !== false,
        });
      }
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
        if (!envEntries.has(key))
          envEntries.set(key, { name: key, secret: true });
    }
    const envOf = (secret: boolean): EnvEntry[] =>
      [...envEntries.values()]
        .filter((entry) => entry.secret === secret)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) =>
          entry.description
            ? { name: entry.name, description: entry.description }
            : { name: entry.name },
        );

    // Capture the CF email binding so a prebuilt deploy (Lore Deploy) can
    // re-emit `send_email`: `enhanceEmail` cannot introspect there.
    let email: { binding: string } | undefined;
    try {
      ctx.alepha.inject(this.cloudflareEmailProviderName);
      email = { binding: SEND_EMAIL_DEFAULT_BINDING };
    } catch {}

    /*
      `runtimes` is the only runtime declaration (#Q2460). Declared order, never
      sorted: the first is the primary, which is what a deployer spawns.

      A static build is one `static` slice with no entry: "nothing, serve the
      files" is a legitimate answer to what a deployer must do, and stating it
      as a slice keeps every consumer on one path instead of a special case.

      ⚠️ `entry` names a FILE relative to the ARCHIVE ROOT (`index.node.js`),
      because the archive root is the contents of `dist/`.
    */
    const runtimes: BuildManifest["runtimes"] = this.slices.isStaticBuild(
      ctx.options,
    )
      ? [{ runtime: "static" }]
      : await Promise.all(
          this.slices.fromOptions(ctx.options).map(async (runtime) => ({
            runtime,
            entry: this.slices.entryFileName(runtime),
            runtimeVersion: await this.resolveRuntimeVersion(root, runtime),
          })),
        );

    const manifest: BuildManifest = {
      project: name,
      runtimes,
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
      secrets: envOf(true),
      variables: envOf(false),
      // Only what a Worker deploy reads, and only when there is a Worker slice
      // to deploy: a node-only artifact carries no Cloudflare noise.
      cloudflare: runtimes.some((slice) => slice.runtime === "workerd")
        ? {
            config: ctx.options.cloudflare?.config as
              | Record<string, unknown>
              | undefined,
            websocketPaths,
            email,
          }
        : undefined,
    };

    // Validated on the way out, not merely typed on the way in: every field
    // here is read by a deployer that has no access to this build, so a wrong
    // value is discovered in production by something that cannot say where it
    // came from. Parsing before a WRITE is safe only because the schema is
    // `.loose()`: a plain `z.object` would strip unknown keys silently.
    const validated = buildManifestSchema.parse(manifest);

    // `writeFile` does not create parent directories. This used to be safe by
    // accident — the manifest was written from the Cloudflare task, which only
    // ever ran after the bundle steps had created `dist/`. Running for every
    // target means no such guarantee.
    await this.fs.mkdir(this.fs.join(root, distDir), { recursive: true });
    await this.fs.writeFile(
      this.fs.join(root, distDir, "manifest.json"),
      JSON.stringify(validated, null, 2),
    );
  }
}
