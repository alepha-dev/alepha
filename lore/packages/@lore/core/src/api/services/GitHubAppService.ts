import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "alepha/server";

import { type GitHubAppRow, githubApps } from "../entities/githubApps.ts";
import type { GitHubAppRotateBody } from "../schemas/githubAppRotateBodySchema.ts";
import type { GitHubAppStatus } from "../schemas/githubAppStatusSchema.ts";
import type { GitHubManifestStart } from "../schemas/githubManifestStartSchema.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { GitHubKeyFormat } from "./GitHubKeyFormat.ts";
import { GitHubStateService } from "./GitHubStateService.ts";
import { GitHubTransport } from "./GitHubTransport.ts";

/**
 * The App's credentials, opened: only ever held in memory, for one call.
 */
export interface GitHubAppCredentials {
  source: "environment" | "stored";
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  /**
   * PKCS#8 PEM, whatever was stored or set.
   */
  privateKey: string;
  webhookSecret: string;
}

/**
 * The instance's GitHub App (#Q4360, epic #E177): created by GitHub's
 * manifest flow from Admin > GitHub, or registered by hand and given by the
 * environment.
 *
 * ## The manifest flow
 *
 * {@link startManifest} answers a form for the browser to post to GitHub
 * (`/settings/apps/new`, or an organization's), carrying the manifest and a
 * signed `state` bound to the admin. GitHub creates the App and sends the
 * admin back to `<PUBLIC_URL>/admin/github?code&state`; that page calls
 * {@link completeManifest}, which claims the state once and exchanges the
 * one-time code (`POST /app-manifests/:code/conversions`) for the App's id,
 * slug, private key, webhook secret and client id and secret.
 *
 * ## Environment wins
 *
 * An App registered by hand is given as `GITHUB_APP_ID`,
 * `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`,
 * `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_SLUG`,
 * and wins over the stored row. Setting only some of them leaves the App
 * unconfigured, and the status names the missing ones.
 *
 * ## Secrets
 *
 * Sealed with `CredentialSealService.GITHUB_APP_PURPOSE`, never returned,
 * logged or shown after creation: {@link status} is identity and links only.
 */
export class GitHubAppService {
  /**
   * The one row's id.
   */
  public static readonly ROW_ID = "instance";

  /**
   * Where GitHub posts deliveries, under `PUBLIC_URL`.
   */
  public static readonly WEBHOOK_PATH = "/api/github/webhook";

  /**
   * Where GitHub sends the admin back after creating the App.
   */
  public static readonly MANIFEST_RETURN_PATH = "/admin/github";

  /**
   * Where GitHub sends a member back after installing the App (#Q4362): the
   * App's callback URL, since it asks for the installer's authorization.
   */
  public static readonly INSTALL_CALLBACK_PATH = "/github/connect";

  public static readonly API_BASE = "https://api.github.com";

  public static readonly API_VERSION = "2022-11-28";

  /**
   * Permissions the App asks (#Q4360). Write on contents and actions from
   * the start: agent jobs push, and workflows are dispatched later, and a
   * permission added afterwards makes every installation re-approve.
   * `workflows` is never asked, so a push touching `.github/workflows/` is
   * refused by GitHub.
   */
  public static readonly PERMISSIONS = {
    metadata: "read",
    contents: "write",
    actions: "write",
    pull_requests: "write",
    checks: "write",
    statuses: "write",
  } as const;

  /**
   * Events the App subscribes to. `installation` and
   * `installation_repositories` are delivered to every App without being
   * listed, and GitHub refuses them in a manifest.
   */
  public static readonly EVENTS = [
    "repository",
    "push",
    "pull_request",
    "pull_request_review",
    "check_suite",
    "check_run",
    "status",
    "workflow_run",
  ] as const;

  /**
   * The variables an App registered by hand sets, all of them required.
   */
  public static readonly ENV = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_WEBHOOK_SECRET",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_SLUG",
  ] as const;

  protected readonly alepha = $inject(Alepha);
  protected readonly rows = $repository(githubApps);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly keys = $inject(GitHubKeyFormat);
  protected readonly states = $inject(GitHubStateService);
  protected readonly transport = $inject(GitHubTransport);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The opened credentials of the stored row, kept for the process (an
   * isolate on workerd): opening three AES-GCM values on every delivery
   * would be work for nothing. Dropped on every write of the row.
   */
  protected cached?: Promise<GitHubAppCredentials | undefined>;

  /**
   * The App's credentials, or none when the instance has no App.
   */
  async credentials(): Promise<GitHubAppCredentials | undefined> {
    const env = this.fromEnvironment();
    if (env !== undefined) return env ?? undefined;
    this.cached ??= this.fromRow().catch((error) => {
      this.cached = undefined;
      throw error;
    });
    return await this.cached;
  }

  /**
   * The App's credentials, or a 503 saying the instance has none.
   */
  async require(): Promise<GitHubAppCredentials> {
    const credentials = await this.credentials();
    if (!credentials) {
      throw new ServiceUnavailableError(
        "This Lore instance has no GitHub App. An instance admin creates it from Admin > GitHub.",
      );
    }
    return credentials;
  }

  async status(): Promise<GitHubAppStatus> {
    const webhookUrl = this.url(GitHubAppService.WEBHOOK_PATH);
    const row = await this.row();
    const missing = this.missingEnvironment();
    const env = this.fromEnvironment();
    const base = {
      ...(webhookUrl ? { webhookUrl } : {}),
      ...(row?.webhookPingAt ? { webhookPingAt: row.webhookPingAt } : {}),
    };
    if (env) {
      return {
        configured: true,
        source: "environment",
        appId: env.appId,
        slug: env.slug,
        installUrl: this.installUrl(env.slug),
        htmlUrl: `https://github.com/apps/${env.slug}`,
        ...base,
      };
    }
    if (missing.length > 0) {
      return { configured: false, missing, ...base };
    }
    if (!row) return { configured: false, ...base };
    return {
      configured: true,
      source: "stored",
      appId: row.appId,
      slug: row.slug,
      name: row.name,
      ...(row.ownerLogin ? { ownerLogin: row.ownerLogin } : {}),
      htmlUrl: row.htmlUrl,
      installUrl: this.installUrl(row.slug),
      createdAt: row.createdAt,
      ...base,
    };
  }

  /**
   * The App's settings page on GitHub (#Q4561), where Display information
   * takes its logo: GitHub's manifest has no logo field and no API uploads
   * one. An organization's Apps live under the organization's settings, a
   * user's under the user's own.
   */
  settingsUrl(slug: string, owner: { login?: string; type?: string }): string {
    const app = encodeURIComponent(slug);
    if (owner.type === "Organization" && owner.login) {
      return `https://github.com/organizations/${encodeURIComponent(owner.login)}/settings/apps/${app}`;
    }
    return `https://github.com/settings/apps/${app}`;
  }

  installUrl(slug: string): string {
    return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
  }

  /**
   * The manifest GitHub creates the App from.
   */
  manifest(name: string, isPublic = true): Record<string, unknown> {
    const home = this.url("");
    const webhook = this.url(GitHubAppService.WEBHOOK_PATH);
    const returnTo = this.url(GitHubAppService.MANIFEST_RETURN_PATH);
    const callback = this.url(GitHubAppService.INSTALL_CALLBACK_PATH);
    if (!home || !webhook || !returnTo || !callback) {
      throw new BadRequestError(
        "Set PUBLIC_URL to this instance's public address first: GitHub posts its webhooks there.",
      );
    }
    return {
      name,
      url: home,
      description:
        "Lore: pull requests, checks and agent jobs for the projects that connect a repository.",
      hook_attributes: { url: webhook, active: true },
      redirect_url: returnTo,
      callback_urls: [callback],
      // The epic review's answer to item 2: GitHub sends the installer back
      // to the callback URL with a user code, so Lore can prove the member
      // reaches the repository they pick (#Q4362). The setup URL is then
      // not used.
      request_oauth_on_install: true,
      setup_on_update: false,
      // Public by default (#Q4561): GitHub lets only its owner install a
      // private App, so every project could connect only the owner's
      // repositories. Public is safe, since a connection still proves the
      // member's own GitHub account reaches the repository (#Q4362); its cost
      // is a public App page showing the name and Lore's URL.
      public: isPublic,
      default_permissions: GitHubAppService.PERMISSIONS,
      default_events: GitHubAppService.EVENTS,
    };
  }

  async startManifest(input: {
    userId: string;
    name?: string;
    organization?: string;
    public?: boolean;
  }): Promise<GitHubManifestStart> {
    await this.refuseIfConfigured();
    const name = input.name ?? this.defaultName();
    const manifest = JSON.stringify(this.manifest(name, input.public ?? true));
    const state = await this.states.issue({
      purpose: "manifest",
      userId: input.userId,
    });
    const owner = input.organization
      ? `organizations/${encodeURIComponent(input.organization)}/`
      : "";
    return {
      action: `https://github.com/${owner}settings/apps/new?state=${encodeURIComponent(state)}`,
      manifest,
      state,
    };
  }

  /**
   * Stores the App GitHub created, once.
   *
   * The state is claimed before GitHub is asked anything, so a replayed or
   * forged callback costs nothing and stores nothing.
   */
  async completeManifest(input: {
    userId: string;
    code: string;
    state: string;
  }): Promise<GitHubAppStatus> {
    await this.states.claim(input.state, {
      purpose: "manifest",
      userId: input.userId,
    });
    await this.refuseIfConfigured();
    const response = await this.transport.send({
      method: "POST",
      url: `${GitHubAppService.API_BASE}/app-manifests/${encodeURIComponent(input.code)}/conversions`,
      headers: this.headers(),
    });
    if (response.status !== 201 && response.status !== 200) {
      throw new BadRequestError(
        `GitHub refused to hand over the new App (${response.status}). Its code lasts one hour and is used once: create the App again.`,
      );
    }
    const app = this.parse(response.body);
    const appId = String(app.id ?? "");
    const slug = this.text(app.slug, 100);
    const clientId = this.text(app.client_id, 64);
    const pem = typeof app.pem === "string" ? app.pem : "";
    const webhookSecret =
      typeof app.webhook_secret === "string" ? app.webhook_secret : "";
    const clientSecret =
      typeof app.client_secret === "string" ? app.client_secret : "";
    if (!/^\d+$/.test(appId) || !slug || !clientId || !pem || !webhookSecret) {
      throw new BadRequestError(
        "GitHub's answer is missing the App's id, slug, key or webhook secret",
      );
    }
    const privateKey = this.keys.toPkcs8Pem(pem);
    try {
      await this.rows.create({
        id: GitHubAppService.ROW_ID,
        appId,
        slug,
        name: this.text(app.name, 100) || slug,
        htmlUrl:
          this.text(app.html_url, 512) || `https://github.com/apps/${slug}`,
        ...(this.text(app.owner?.login, 100)
          ? { ownerLogin: this.text(app.owner?.login, 100) }
          : {}),
        clientId,
        clientSecret: await this.sealed(clientSecret || "none"),
        privateKey: await this.sealed(privateKey),
        webhookSecret: await this.sealed(webhookSecret),
        credentialKeyVersion: CredentialSealService.KEY_VERSION,
        createdBy: input.userId,
      });
    } catch {
      throw new ConflictError("This instance already has a GitHub App");
    }
    this.cached = undefined;
    return await this.status();
  }

  /**
   * Replaces a secret of the stored App. The environment's are the
   * environment's, and are rotated there.
   */
  async rotate(body: GitHubAppRotateBody): Promise<GitHubAppStatus> {
    if (this.fromEnvironment()) {
      throw new ConflictError(
        "This instance's GitHub App comes from its environment: rotate the GITHUB_APP_* values there.",
      );
    }
    const row = await this.row();
    if (!row) throw new NotFoundError("This instance has no stored GitHub App");
    const update: Partial<GitHubAppRow> = {};
    if (body.privateKey) {
      update.privateKey = await this.sealed(
        this.keys.toPkcs8Pem(body.privateKey),
      );
    }
    if (body.webhookSecret) {
      update.webhookSecret = await this.sealed(body.webhookSecret);
    }
    if (body.clientSecret) {
      update.clientSecret = await this.sealed(body.clientSecret);
    }
    if (Object.keys(update).length === 0) {
      throw new BadRequestError(
        "Give a new private key, webhook secret or client secret",
      );
    }
    await this.rows.updateById(GitHubAppService.ROW_ID, update);
    this.cached = undefined;
    return await this.status();
  }

  /**
   * Forgets the stored App. The App itself stays on GitHub, where its owner
   * deletes it.
   */
  async remove(): Promise<void> {
    await this.rows.deleteMany({ id: GitHubAppService.ROW_ID });
    this.cached = undefined;
  }

  /**
   * GitHub's `ping` reached the webhook: the URL is reachable.
   */
  async recordPing(): Promise<void> {
    await this.rows.updateMany(
      { id: GitHubAppService.ROW_ID },
      { webhookPingAt: this.dateTime.nowISOString() },
    );
  }

  /**
   * The headers every call to GitHub's REST API carries.
   */
  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "x-github-api-version": GitHubAppService.API_VERSION,
      "user-agent": "lore",
      ...extra,
    };
  }

  /**
   * An absolute URL under `PUBLIC_URL`, or undefined while it is not set.
   */
  url(path: string): string | undefined {
    const base = String(this.alepha.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) return undefined;
    return `${base}${path}`;
  }

  protected async refuseIfConfigured(): Promise<void> {
    if (this.fromEnvironment() || (await this.row())) {
      throw new ConflictError("This instance already has a GitHub App");
    }
  }

  protected defaultName(): string {
    const host = (() => {
      try {
        return new URL(this.url("") ?? "").hostname;
      } catch {
        return "";
      }
    })();
    return `Lore ${host}`.trim().slice(0, 34);
  }

  protected async row(): Promise<GitHubAppRow | undefined> {
    const [row] = await this.rows.findMany({
      where: { id: GitHubAppService.ROW_ID },
      limit: 1,
    });
    return row;
  }

  protected async fromRow(): Promise<GitHubAppCredentials | undefined> {
    const row = await this.row();
    if (!row) return undefined;
    const purpose = CredentialSealService.GITHUB_APP_PURPOSE;
    return {
      source: "stored",
      appId: row.appId,
      slug: row.slug,
      clientId: row.clientId,
      clientSecret: await this.seal.open(row.clientSecret, purpose),
      privateKey: await this.seal.open(row.privateKey, purpose),
      webhookSecret: await this.seal.open(row.webhookSecret, purpose),
    };
  }

  /**
   * The environment's App: credentials when every variable is set, `null`
   * when some are (a misconfiguration, which also hides the stored row),
   * undefined when none is.
   */
  protected fromEnvironment(): GitHubAppCredentials | null | undefined {
    const env = this.alepha.env as Record<string, unknown>;
    const set = GitHubAppService.ENV.filter((name) => this.envValue(env[name]));
    if (set.length === 0) return undefined;
    if (set.length < GitHubAppService.ENV.length) return null;
    return {
      source: "environment",
      appId: this.envValue(env.GITHUB_APP_ID),
      slug: this.envValue(env.GITHUB_APP_SLUG),
      clientId: this.envValue(env.GITHUB_APP_CLIENT_ID),
      clientSecret: this.envValue(env.GITHUB_APP_CLIENT_SECRET),
      privateKey: this.keys.toPkcs8Pem(
        this.envValue(env.GITHUB_APP_PRIVATE_KEY),
      ),
      webhookSecret: this.envValue(env.GITHUB_APP_WEBHOOK_SECRET),
    };
  }

  protected missingEnvironment(): string[] {
    const env = this.alepha.env as Record<string, unknown>;
    const set = GitHubAppService.ENV.filter((name) => this.envValue(env[name]));
    if (set.length === 0) return [];
    return GitHubAppService.ENV.filter((name) => !this.envValue(env[name]));
  }

  protected envValue(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "";
  }

  protected async sealed(value: string): Promise<string> {
    return await this.seal.seal(
      value,
      CredentialSealService.GITHUB_APP_PURPOSE,
    );
  }

  protected parse(body: string): Record<string, any> {
    try {
      const value = JSON.parse(body);
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  /**
   * A text field from GitHub, as data: a string, capped, or empty.
   */
  protected text(value: unknown, max: number): string {
    return typeof value === "string" ? value.slice(0, max) : "";
  }
}
