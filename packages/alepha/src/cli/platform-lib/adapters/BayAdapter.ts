import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $inject, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import {
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
} from "./PlatformAdapter.ts";

/**
 * Deploys to Alepha Bay — a self-hosted application server on a machine you own.
 *
 * The whole adapter is thin, and that is the point: Bay consumes the artifact
 * the framework already produces. There is no Bay-specific build target and no
 * Bay-specific manifest — `alepha build` emits `dist/manifest.json` describing
 * what the app declares, `alepha pack` wraps it with `migrations/`, and this
 * uploads the result. A second description of the same app is exactly the
 * code↔infra drift the derived manifest exists to prevent.
 *
 * **Resources are not provisioned from here.** `provision` stays empty because
 * Bay reads the manifest and creates the database, the storage directory and
 * the sandbox's writable paths itself. Declaring `$repository` is what
 * provisions the database; nothing in this file needs to know that.
 */
export class BayAdapter extends PlatformAdapter {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);

  /**
   * The Bay whose control panel this deploys through.
   *
   * A Bay is a machine someone owns, so unlike Cloudflare there is no global
   * endpoint to assume — it has to be configured. `$BAY_ENDPOINT` wins so a fork
   * or a second Bay needs no edit to `alepha.config.ts`.
   */
  protected endpoint(ctx: PlatformContext): string {
    const configured = process.env.BAY_ENDPOINT ?? ctx.envConfig.endpoint;
    if (!configured) {
      throw new AlephaError(
        `No Bay endpoint for environment "${ctx.env}". Set it in alepha.config.ts — ` +
          `platform({ environments: { ${ctx.env}: { adapter: "bay", endpoint: "https://admin.example.com" } } }) — ` +
          "or export BAY_ENDPOINT.",
      );
    }
    return configured.replace(/\/$/, "");
  }

  /**
   * Reads the credential, without ever printing it.
   *
   * An API key rather than an interactive login because `alepha platform up`
   * runs in CI as often as on a laptop, and a device flow has nobody there to
   * complete it. An interactive login is worth adding later as a convenience
   * for a developer's machine; it cannot replace this.
   */
  protected async apiKey(): Promise<string> {
    const fromEnv = process.env.BAY_API_KEY;
    if (fromEnv) {
      return fromEnv;
    }
    // A file so the key never has to live in shell history, and so CI and a
    // laptop use the same code path.
    const path = join(
      process.env.HOME ?? ".",
      ".config",
      "alepha",
      "bay-api-key",
    );
    try {
      const body = await readFile(path, "utf8");
      const key = body.trim();
      if (key) {
        return key;
      }
    } catch {}
    throw new AlephaError(
      "No Bay credential. Create an API key in the Bay admin UI, then either " +
        `export BAY_API_KEY, or write it to ${path}.`,
    );
  }

  async authenticate(ctx: PlatformContext, _run: RunnerMethod): Promise<void> {
    const endpoint = this.endpoint(ctx);
    const key = await this.apiKey();
    // Fail here rather than after a two-minute build. `authenticate` runs first
    // precisely so a bad credential costs a second, not a full pipeline.
    const res = await fetch(`${endpoint}/api/bay/status`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new AlephaError(
        `Bay at ${endpoint} rejected the credential. Is the key still valid, and does its user have the admin role?`,
      );
    }
    if (!res.ok) {
      throw new AlephaError(
        `Bay at ${endpoint} answered ${res.status} to an authentication check.`,
      );
    }
    this.log.info(`Authenticated against ${endpoint}`);
  }

  /**
   * Builds the artifact Bay consumes.
   *
   * `--target=bare` and nothing else. A workerd bundle is resolved against
   * Cloudflare's export conditions and has no node-runnable entry point, so Bay
   * refuses it at deploy time — better to never produce one.
   */
  async build(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    if (ctx.prebuilt) {
      // Nothing target-specific to regenerate: there is no wrangler.jsonc
      // equivalent, because everything Bay needs is already in the manifest.
      return;
    }
    await run({
      name: "build (bay)",
      handler: async () => {
        await this.shell.run("yarn alepha build --target=bare", {
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
    const key = await this.apiKey();

    let artifact = "";
    await run({
      name: "pack",
      handler: async () => {
        await this.shell.run("yarn alepha pack", { root: ctx.root });
        artifact = join(ctx.root, `${ctx.project}-latest.tar.gz`);
        if (!(await this.fs.exists(artifact))) {
          throw new AlephaError(`\`alepha pack\` produced no ${artifact}.`);
        }
      },
    });

    let url: string | undefined;
    await run({
      name: `deploy → ${endpoint}`,
      handler: async () => {
        const body = await this.fs.readFile(artifact);
        // Multipart, matching the endpoint the admin UI already posts to. One
        // endpoint with two callers beats a second one that drifts: a bug fixed
        // for the browser is then fixed for the CLI by construction.
        const form = new FormData();
        form.set(
          "file",
          new Blob([new Uint8Array(body)], {
            type: "application/gzip",
          }),
          `${ctx.project}.tar.gz`,
        );
        form.set("name", ctx.project);
        form.set("env", ctx.env);
        // Optional: with no domain, Bay composes the subdomain from the app
        // name and its own base domain, so a workspace that configures nothing
        // still lands somewhere predictable.
        if (ctx.envConfig.domain) {
          form.set("domain", ctx.envConfig.domain);
        }
        const res = await fetch(`${endpoint}/api/bay/apps`, {
          method: "POST",
          // No content-type: fetch sets it with the multipart boundary, and
          // overriding it makes the body unparseable.
          headers: { authorization: `Bearer ${key}` },
          body: form,
        });
        const text = await res.text();
        if (!res.ok) {
          // Bay's messages are written for an operator — "rebuild with
          // --target=bare", "redeploy the app to migrate it". Surfaced as-is:
          // replacing them throws away the only part that says what to do.
          throw new AlephaError(
            `Bay refused the deploy (${res.status}): ${this.reason(text)}`,
          );
        }
        url = this.reason(text, "url") ?? undefined;
      },
    });
    return url;
  }

  /**
   * Migrations are the app's own business.
   *
   * Alepha runs them during its own boot as soon as `migrations/` is present
   * next to the bundle, and `alepha pack` always includes it. A migrate step
   * here would either duplicate that or race it.
   */
  async migrate(): Promise<void> {}

  async inspect(ctx: PlatformContext): Promise<PlatformState> {
    const endpoint = this.endpoint(ctx);
    const key = await this.apiKey();
    const res = await fetch(`${endpoint}/api/bay/apps`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      throw new AlephaError(`Bay at ${endpoint} answered ${res.status}.`);
    }
    const apps = (await res.json()) as Array<{
      name: string;
      env: string;
      domain: string;
      release: string;
    }>;
    const mine = apps.filter(
      (a) => a.name === ctx.project && a.env === ctx.env,
    );
    return {
      workers: mine.map((a) => ({
        name: `${a.name}/${a.env}`,
        exists: true,
        detail: a.domain,
        version: a.release,
      })),
      // Bay provisions these itself, from the manifest, and exposes no
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
   * Unregisters the app, keeping its data.
   *
   * Deliberately divergent from Cloudflare, where teardown really destroys. On
   * Cloudflare the data lives in D1 and R2, which outlive the worker; on Bay the
   * database and the uploads sit in the app's own directory, so a naive teardown
   * would delete them with no way back. "Stop serving this" is the usual intent,
   * and destroying data has to be asked for.
   */
  async teardown(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    const endpoint = this.endpoint(ctx);
    const key = await this.apiKey();
    await run({
      name: `remove ${ctx.project}/${ctx.env}`,
      handler: async () => {
        const res = await fetch(
          `${endpoint}/api/bay/apps/${ctx.project}/${ctx.env}`,
          { method: "DELETE", headers: { authorization: `Bearer ${key}` } },
        );
        if (!res.ok && res.status !== 404) {
          throw new AlephaError(
            `Bay refused the removal (${res.status}): ${this.reason(await res.text())}`,
          );
        }
        this.log.info(
          `Removed ${ctx.project}/${ctx.env}. Its database and uploads are kept on the host.`,
        );
      },
    });
  }

  /**
   * Pulls a field out of a JSON body, falling back to the raw text.
   *
   * Bay answers Alepha's error shape, so `message` is the operator-facing
   * sentence. A body that is not JSON at all usually means something in front of
   * Bay answered instead — a proxy error page — and showing it verbatim is more
   * useful than "unexpected token <".
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
