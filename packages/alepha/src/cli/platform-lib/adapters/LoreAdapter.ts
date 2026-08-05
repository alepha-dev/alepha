import { createHash } from "node:crypto";
import { $inject, $store, AlephaError } from "alepha";
import { buildOptions, PackageManagerUtils } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import {
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
} from "./PlatformAdapter.ts";

/**
 * Deploys through Lore, which hands the artifact to whichever machine hosts the
 * app.
 *
 * The shape that matters: **nothing here ever contacts the machine.** The
 * artifact goes to Lore, a row is written, and a Bay somewhere asks for work on
 * its own outbound channel. No inbound port is opened, no address is known, and
 * the supervisor's control API stays the unix socket it has always been.
 *
 * The cost is that `up` cannot watch a deploy directly — so it watches the row
 * instead, and does not return until the release is serving or has failed. A
 * green build means it serves. That is the whole contract, and everything below
 * exists to keep it true.
 */
export class LoreAdapter extends PlatformAdapter {
  protected readonly log = $logger();
  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly buildOptions = $store(buildOptions);

  /**
   * How long `up` waits for a machine to finish.
   *
   * Ten minutes covers a slow pull plus migrations on a large database. It must
   * stay well ABOVE the sink's claim expiry (one minute), or the client gives
   * up on a release that a second outpost would have picked up on its own.
   */
  protected static readonly DEPLOY_TIMEOUT_MS = 600_000;

  /**
   * How often the release row is re-read.
   *
   * Two seconds is fast against a deploy measured in tens of seconds, and the
   * response is one row.
   */
  protected static readonly POLL_INTERVAL_MS = 2_000;

  /**
   * The default sink, so an app that configures nothing still lands somewhere
   * predictable. `$LORE_ENDPOINT` overrides it without editing a config file.
   */
  protected static readonly DEFAULT_ENDPOINT = "https://lore.alepha.dev";

  protected endpoint(ctx: PlatformContext): string {
    const configured =
      process.env.LORE_ENDPOINT ??
      ctx.envConfig.endpoint ??
      LoreAdapter.DEFAULT_ENDPOINT;
    return configured.replace(/\/+$/, "");
  }

  /**
   * The Lore project a release is written into.
   *
   * Required, and deliberately not derived from `ctx.project` (this app's own
   * name): Lore project ids and this app's project name are separate
   * namespaces, and guessing a mapping between them would silently deploy
   * into whichever Lore project happened to match.
   */
  protected projectId(ctx: PlatformContext): number {
    const configured = ctx.envConfig.projectId;
    if (!configured) {
      throw new AlephaError(
        `No Lore project for environment "${ctx.env}". Set it in alepha.config.ts — ` +
          `platform({ environments: { ${ctx.env}: { adapter: "lore", projectId: 42 } } })`,
      );
    }
    return Number(configured);
  }

  protected apiKey(): string {
    const key = process.env.LORE_API_KEY;
    if (!key) {
      throw new AlephaError(
        "No LORE_API_KEY in the environment. Mint one in Lore (Profile → API keys) " +
          "under an account that is a member of the target Lore project, and put it in " +
          "the deploy job's secrets. A device-flow login wants a human, and there is " +
          "nobody at the keyboard in CI.",
      );
    }
    return key;
  }

  /**
   * Proves the credential works before anything expensive happens.
   *
   * Listing the Lore project's releases checks two things at once — that the
   * key is valid, and that it can see the Lore project being deployed to.
   * Failing here costs a second; failing after the build costs two minutes.
   */
  async authenticate(ctx: PlatformContext, _run: RunnerMethod): Promise<void> {
    const endpoint = this.endpoint(ctx);
    const projectId = this.projectId(ctx);

    const res = await fetch(`${endpoint}/api/projects/${projectId}/releases`, {
      headers: { authorization: `Bearer ${this.apiKey()}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new AlephaError(
        `${endpoint} rejected the credential for Lore project ${projectId}. ` +
          "Is the key still valid, and is its owner a member of that project?",
      );
    }
    if (!res.ok) {
      throw new AlephaError(
        `${endpoint} answered ${res.status} to an authentication check.`,
      );
    }
    this.log.info(`Authenticated against ${endpoint}`);
  }

  /**
   * Builds the artifact a Bay can run.
   *
   * `bare` is forced rather than inherited: a workerd bundle is resolved
   * against Cloudflare's export conditions and has no node-runnable entry
   * point, so Bay refuses it at deploy time — better to never produce one.
   *
   * `static` is the one target that survives, because it is not a different
   * way of building a server — it is the absence of one. Forcing `bare` over
   * it built a server bundle for a site that has no process, shipped it, and
   * left Bay to spawn it.
   */
  async build(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    if (ctx.prebuilt) {
      return;
    }
    const target = this.buildOptions.target === "static" ? "static" : "bare";

    await run({
      name: "build (lore)",
      handler: async () => {
        await this.shell.run(await this.cli(ctx, `build --target=${target}`), {
          root: ctx.root,
        });
      },
    });
  }

  async deploy(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    const endpoint = this.endpoint(ctx);
    const projectId = this.projectId(ctx);
    const key = this.apiKey();

    let artifact = "";
    await run({
      name: "pack",
      handler: async () => {
        await this.shell.run(await this.cli(ctx, "pack"), { root: ctx.root });
        artifact = this.fs.join(ctx.root, `${ctx.project}-latest.tar.gz`);
        if (!(await this.fs.exists(artifact))) {
          throw new AlephaError(`\`alepha pack\` produced no ${artifact}.`);
        }
      },
    });

    let releaseId = "";
    const version = this.version();
    await run({
      name: `upload → ${endpoint}`,
      handler: async () => {
        const bytes = await this.fs.readFile(artifact);
        const sha256 = createHash("sha256").update(bytes).digest("hex");

        const form = new FormData();
        form.set(
          "file",
          new Blob([new Uint8Array(bytes)], { type: "application/gzip" }),
          `${ctx.project}.tar.gz`,
        );
        // No content-type header: fetch sets it with the multipart boundary,
        // and overriding it makes the body unparseable.
        const uploaded = await fetch(`${endpoint}/api/files?bucket=releases`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: form,
        });
        if (!uploaded.ok) {
          throw new AlephaError(
            `Lore refused the artifact (${uploaded.status}): ${this.reason(await uploaded.text())}`,
          );
        }
        const file = (await uploaded.json()) as { id: string };

        const registered = await fetch(
          `${endpoint}/api/projects/${projectId}/releases`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              app: ctx.project,
              environment: ctx.env,
              version,
              sha256,
              fileId: file.id,
              sizeBytes: bytes.length,
            }),
          },
        );
        if (!registered.ok) {
          throw new AlephaError(
            `Lore refused the release (${registered.status}): ${this.reason(await registered.text())}`,
          );
        }
        releaseId = ((await registered.json()) as { id: string }).id;
      },
    });

    let url: string | undefined;
    await run({
      name: `deploy ${ctx.project}/${ctx.env}`,
      handler: async () => {
        url = await this.follow(ctx, releaseId);
      },
    });
    return url;
  }

  /**
   * Watches a release until a machine has finished with it.
   *
   * This is what makes a green build mean "it serves". Returning at upload
   * would leave a failed deploy — a bad target, a migration that explodes —
   * behind a passing pipeline, and the only place it would show is a dashboard
   * nobody opens after a green run.
   */
  protected async follow(
    ctx: PlatformContext,
    releaseId: string,
  ): Promise<string | undefined> {
    const endpoint = this.endpoint(ctx);
    const projectId = this.projectId(ctx);
    const key = this.apiKey();
    const deadline = this.dateTime.nowMillis() + LoreAdapter.DEPLOY_TIMEOUT_MS;

    let last = "";
    while (this.dateTime.nowMillis() < deadline) {
      const res = await fetch(
        `${endpoint}/api/projects/${projectId}/releases/${releaseId}`,
        { headers: { authorization: `Bearer ${key}` } },
      );
      if (!res.ok) {
        throw new AlephaError(
          `Lore answered ${res.status} while following the release.`,
        );
      }
      const release = (await res.json()) as {
        status: string;
        failureReason?: string;
        app: string;
        environment: string;
      };

      if (release.status !== last) {
        last = release.status;
        this.log.info(`Release ${releaseId}: ${release.status}`);
      }

      if (release.status === "serving") {
        return ctx.envConfig.domain
          ? `https://${ctx.envConfig.domain}/`
          : undefined;
      }
      if (release.status === "failed") {
        // Bay's own sentence, verbatim. It is written for an operator —
        // "rebuild with --target=bare", "redeploy the app to migrate it" — and
        // replacing it throws away the only part that says what to do.
        throw new AlephaError(
          `Deploy failed: ${release.failureReason ?? "no reason reported"}`,
        );
      }

      await this.sleep(LoreAdapter.POLL_INTERVAL_MS);
    }

    throw new AlephaError(
      `Gave up after ${Math.round(LoreAdapter.DEPLOY_TIMEOUT_MS / 60_000)} minutes with the release still '${last || "pending"}'. ` +
        "Either no machine is enrolled in this Lore project, or the one that took it stopped reporting — " +
        "check the outposts page in Lore, then `bay logs <app>/<env>` on the host.",
    );
  }

  /**
   * The release name.
   *
   * A timestamp, matching the directory names Bay already writes, so a release
   * in Lore and a release on disk are the same string rather than two ids that
   * have to be correlated.
   */
  protected version(): string {
    const at = new Date(this.dateTime.nowMillis());
    const pad = (n: number) => String(n).padStart(2, "0");
    // UTC, not local: two deploys from two machines in different zones would
    // otherwise produce version names that sort against each other wrongly.
    return [
      at.getUTCFullYear(),
      pad(at.getUTCMonth() + 1),
      pad(at.getUTCDate()),
      `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`,
    ].join("-");
  }

  async inspect(ctx: PlatformContext): Promise<PlatformState> {
    const endpoint = this.endpoint(ctx);
    const projectId = this.projectId(ctx);
    const res = await fetch(`${endpoint}/api/projects/${projectId}/releases`, {
      headers: { authorization: `Bearer ${this.apiKey()}` },
    });
    if (!res.ok) {
      throw new AlephaError(`Lore at ${endpoint} answered ${res.status}.`);
    }
    const body = (await res.json()) as {
      items: Array<{
        app: string;
        environment: string;
        version: string;
        status: string;
      }>;
    };
    const mine = body.items.filter(
      (r) => r.app === ctx.project && r.environment === ctx.env,
    );
    return {
      workers: mine.map((r) => ({
        name: `${r.app}/${r.environment}`,
        exists: true,
        detail: r.status,
        version: r.version,
      })),
      // Bay provisions these itself, from the manifest, and Lore holds no
      // inventory of them. Reporting empty lists is honest; inventing entries
      // from the manifest would report intent as fact.
      databases: [],
      buckets: [],
      kvNamespaces: [],
      queues: [],
      secrets: [],
    };
  }

  /**
   * Refused, on purpose.
   *
   * Removing an app takes its database and its uploads with it, and that
   * decision belongs on the host, at the socket, with an operator present.
   * Wiring it to a remote registry would make "undeploy" a thing a leaked CI
   * key can do.
   */
  async teardown(): Promise<void> {
    throw new AlephaError(
      "The 'lore' adapter does not tear down. Removing an app is an operator " +
        "action on the host: `bay remove <app>/<env>` (its data is kept unless " +
        "you pass --purge).",
    );
  }

  /**
   * Composes an `alepha` CLI invocation for whatever package manager the
   * project actually uses. Only yarn takes the binary bare.
   */
  protected async cli(ctx: PlatformContext, args: string): Promise<string> {
    const pm = await this.pm.getPackageManager(ctx.root);
    switch (pm) {
      case "yarn":
        return `yarn alepha ${args}`;
      case "pnpm":
        return `pnpm exec alepha ${args}`;
      case "bun":
        return `bunx alepha ${args}`;
      default:
        return `npx alepha ${args}`;
    }
  }

  protected async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Pulls a field out of a JSON body, falling back to the raw text.
   *
   * A body that is not JSON usually means something in front of Lore answered
   * instead — a proxy error page — and showing it verbatim is more useful than
   * "unexpected token <".
   */
  protected reason(text: string, field = "message"): string {
    try {
      const parsed = JSON.parse(text);
      return parsed?.[field] ?? text;
    } catch {
      return text.slice(0, 300);
    }
  }
}
