import { join } from "node:path";
import { $inject, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { BayCredentialProvider } from "../providers/BayCredentialProvider.ts";
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
  protected readonly credentials = $inject(BayCredentialProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

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
   * `$BAY_API_KEY` first, so CI supplies one with no file and no login. A laptop
   * gets one from `alepha platform auth login`, which is the same currency —
   * one kind of credential in the whole system, revocable in one place.
   */
  protected async apiKey(ctx: PlatformContext): Promise<string> {
    const endpoint = this.endpoint(ctx);
    const token = await this.credentials.get(endpoint);
    if (token) {
      return token;
    }
    throw new AlephaError(
      `Not logged in to ${endpoint}. Run \`alepha platform auth login --env ${ctx.env}\`, ` +
        "or export BAY_API_KEY for a non-interactive caller.",
    );
  }

  /**
   * Obtains a credential through the device grant (RFC 8628).
   *
   * The flow exists because a terminal cannot receive a browser redirect: it
   * prints a short code, the human approves it in a session that already
   * exists, and the CLI polls until it does. Nothing secret is ever typed into
   * the terminal, and nothing lands in shell history.
   */
  async login(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    const endpoint = this.endpoint(ctx);

    const start = await fetch(`${endpoint}/oauth/device_authorization`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "alepha-cli", scope: "deploy" }),
    });
    if (!start.ok) {
      throw new AlephaError(
        `${endpoint} does not offer a device login (${start.status}). ` +
          "Is it a Bay admin panel, and is its OAuth server enabled?",
      );
    }
    const grant = (await start.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
      interval?: number;
      expires_in?: number;
    };

    // Printed, not logged: this is the one moment the user must read something,
    // and a log prefix in front of it makes it harder to see, not easier.
    process.stdout.write(
      `\n  Open       ${grant.verification_uri_complete ?? grant.verification_uri}\n` +
        `  Your code  ${grant.user_code}\n\n`,
    );

    // Assigned rather than returned: the runner logs whatever its handler
    // returns, and this is a bearer token. Returning it would print it in the
    // terminal and into every CI log that ever runs this command.
    let token = "";
    await run({
      name: "waiting for approval",
      handler: async () => {
        token = await this.pollForToken(endpoint, grant.device_code, {
          intervalMs: (grant.interval ?? 5) * 1000,
          // One second less than the server's own expiry, so the CLI gives up
          // just before the code does and can say why rather than reporting
          // whatever the server returns at the boundary.
          deadline:
            this.dateTime.nowMillis() + ((grant.expires_in ?? 600) - 1) * 1000,
        });
      },
    });

    await this.credentials.set(endpoint, token);
    this.log.info(`Logged in to ${endpoint}`);
  }

  async logout(ctx: PlatformContext, _run: RunnerMethod): Promise<void> {
    const endpoint = this.endpoint(ctx);
    const had = await this.credentials.clear(endpoint);
    this.log.info(
      had
        ? `Forgot the credential for ${endpoint}. It is still valid — revoke it in the admin UI to be sure.`
        : `No stored credential for ${endpoint}.`,
    );
  }

  /**
   * Polls the token endpoint until the human answers.
   *
   * Every branch here is an error string RFC 8628 defines, and each means
   * something different to do: keep waiting, back off, stop because the user
   * said no, stop because the code died. Treating them alike would either spin
   * forever on a refusal or give up on a slow user.
   */
  protected async pollForToken(
    endpoint: string,
    deviceCode: string,
    opts: { intervalMs: number; deadline: number },
  ): Promise<string> {
    let wait = opts.intervalMs;
    while (this.dateTime.nowMillis() < opts.deadline) {
      await new Promise((resolve) => setTimeout(resolve, wait));

      const res = await fetch(`${endpoint}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: "alepha-cli",
        }),
      });
      const body = (await res.json()) as {
        access_token?: string;
        error?: string;
      };

      if (res.ok && body.access_token) {
        return body.access_token;
      }
      switch (body.error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          // The server is telling us we are too fast; obeying is the whole
          // point of it saying so.
          wait += 5000;
          continue;
        case "access_denied":
          throw new AlephaError("Login refused.");
        case "expired_token":
          throw new AlephaError(
            "The code expired before it was approved. Run the command again.",
          );
        default:
          throw new AlephaError(
            `Unexpected answer from ${endpoint}: ${body.error ?? res.status}`,
          );
      }
    }
    throw new AlephaError(
      "Gave up waiting for approval. Run the command again when you are ready.",
    );
  }

  async authenticate(ctx: PlatformContext, _run: RunnerMethod): Promise<void> {
    const endpoint = this.endpoint(ctx);
    const key = await this.apiKey(ctx);
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
    const key = await this.apiKey(ctx);

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
    const key = await this.apiKey(ctx);
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
    const key = await this.apiKey(ctx);
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
