import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";

import type { WorkerCloudflareCredential } from "../adapters/WorkerCloudflareAdapter.ts";
import { InfraCacheProvider } from "../providers/InfraCacheProvider.ts";
import { WranglerApi } from "./WranglerApi.ts";

/**
 * Where a CLI run's Cloudflare token came from.
 *
 * - `env`: `CLOUDFLARE_API_TOKEN`, used as is.
 * - `wrangler`: the token a previous `wrangler login` left, read with
 *   `wrangler auth token --json`.
 * - `login`: a `wrangler login` this run started, because there was neither.
 */
export type CloudflareCredentialOrigin = "env" | "wrangler" | "login";

/**
 * A resolved credential, and how it was obtained.
 */
export interface ResolvedCloudflareCredential {
  credential: WorkerCloudflareCredential;
  origin: CloudflareCredentialOrigin;
}

/**
 * The Cloudflare credential of one CLI run, resolved once.
 *
 * ## The order (folio #F1374)
 *
 * 1. `CLOUDFLARE_API_TOKEN`: used as is. Wrangler is neither called nor
 *    installed, which is the CI path and the only headless one.
 * 2. `wrangler auth token --json`: the login a developer already has, read
 *    once per run and held in memory.
 * 3. `wrangler login`, only on a TTY. Off one (CI, a pipe) there is nobody to
 *    finish a browser flow, so the run fails naming `CLOUDFLARE_API_TOKEN`.
 *
 * The account id is resolved beside the token: the environment's `accountId`
 * option, then `CLOUDFLARE_ACCOUNT_ID`, then the token's only account.
 *
 * ## ⚠️ The environment is read HERE, and never by the clients
 *
 * `CloudflareProvisionClient` and `CloudflareDeployClient` take the credential
 * as a constructor argument and refuse to read `process.env`, because inside
 * Lore's Worker `CLOUDFLARE_ACCOUNT_ID` is Lore's own account. This class is
 * the Node-side shell that is allowed to: on a laptop or in CI, the
 * environment is the developer's.
 *
 * Wrangler stays for login only because Cloudflare's device grant is open to
 * first-party clients only; see the decision folio.
 */
export class CloudflareCredentialSource {
  protected readonly log = $logger();
  protected readonly wrangler = $inject(WranglerApi);
  protected readonly cache = $inject(InfraCacheProvider);

  protected static readonly BASE = "https://api.cloudflare.com/client/v4";

  /**
   * The token this run settled on, so a second entry point does not spawn a
   * second wrangler process.
   */
  protected resolvedToken?: {
    token: string;
    origin: CloudflareCredentialOrigin;
  };

  /**
   * Account ids already looked up, by token, so `/accounts` is asked once.
   */
  protected resolvedAccounts = new Map<string, string>();

  /**
   * The credential for one environment.
   *
   * ⚠️ The origin is logged, never the token.
   */
  public async resolve(options: {
    root: string;
    accountId?: string;
    jurisdiction?: "eu" | "fedramp";
  }): Promise<ResolvedCloudflareCredential> {
    const { token, origin } = await this.token(options.root);
    const accountId = await this.accountId(token, origin, options);
    return {
      credential: {
        apiToken: token,
        accountId,
        ...(options.jurisdiction ? { jurisdiction: options.jurisdiction } : {}),
      },
      origin,
    };
  }

  /**
   * The bearer token, from the first source that has one.
   */
  public async token(
    root?: string,
  ): Promise<{ token: string; origin: CloudflareCredentialOrigin }> {
    if (this.resolvedToken) {
      return this.resolvedToken;
    }

    const fromEnv = this.readEnv("CLOUDFLARE_API_TOKEN");
    if (fromEnv) {
      this.log.info("Cloudflare credential: CLOUDFLARE_API_TOKEN");
      this.resolvedToken = { token: fromEnv, origin: "env" };
      return this.resolvedToken;
    }

    const interactive = this.isInteractive();

    // ⚠️ Installed only where a login could follow. Off a TTY a missing token
    // is a failure either way, and installing a devDependency into a CI
    // checkout before failing would leave its package.json changed.
    if (interactive && root) {
      await this.wrangler.ensureInstalled(root);
    }

    const existing = await this.readWranglerToken();
    if (existing) {
      this.log.info("Cloudflare credential: wrangler login");
      this.resolvedToken = { token: existing, origin: "wrangler" };
      return this.resolvedToken;
    }

    if (!interactive) {
      throw new AlephaError(
        "No Cloudflare credential. Set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID when the token sees several accounts); off a terminal, `wrangler login` cannot be completed.",
      );
    }

    await this.wrangler.login();
    const fresh = await this.readWranglerToken();
    if (!fresh) {
      throw new AlephaError(
        "`wrangler login` finished, but `wrangler auth token` still has no token to give. Run `alepha infra login` again, or set CLOUDFLARE_API_TOKEN.",
      );
    }
    this.log.info("Cloudflare credential: fresh wrangler login");
    this.resolvedToken = { token: fresh, origin: "login" };
    return this.resolvedToken;
  }

  /**
   * Forget what this run resolved, so the next call reads its sources again.
   *
   * After `alepha infra login` or `logout`, the token held in memory is the
   * one that was just replaced.
   */
  public reset(): void {
    this.resolvedToken = undefined;
    this.resolvedAccounts.clear();
  }

  /**
   * Wrangler's stored token, or `undefined` when it has none.
   *
   * ⚠️ A global API key is refused by name rather than treated as a missing
   * login: it is a key and an email, not a bearer token, so it cannot go in
   * the `Authorization` header every call here sends, and a fresh login would
   * not replace the environment variables wrangler read it from.
   */
  protected async readWranglerToken(): Promise<string | undefined> {
    let answer: { type?: string; token?: string };
    try {
      answer = await this.wrangler.getAuthToken();
    } catch {
      return undefined;
    }
    if (answer.type === "api_key") {
      throw new AlephaError(
        "wrangler is authenticated with a global API key (CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL), which is not a bearer token. Use an API token in CLOUDFLARE_API_TOKEN, or unset those two and run `alepha infra login`.",
      );
    }
    return answer.token || undefined;
  }

  /**
   * The account the run deploys into.
   *
   * The explicit option wins, then `CLOUDFLARE_ACCOUNT_ID`, then the account a
   * previous run recorded for a wrangler login, then the token's only account.
   *
   * ⚠️ The login cache is consulted for a wrangler token only. An environment
   * token is a deliberate credential, often a CI secret scoped to another
   * account than the developer's own login, and the cache describes the login.
   */
  protected async accountId(
    token: string,
    origin: CloudflareCredentialOrigin,
    options: { root: string; accountId?: string },
  ): Promise<string> {
    if (options.accountId) {
      return options.accountId;
    }
    const fromEnv = this.readEnv("CLOUDFLARE_ACCOUNT_ID");
    if (fromEnv) {
      return fromEnv;
    }
    const known = this.resolvedAccounts.get(token);
    if (known) {
      return known;
    }

    if (
      origin !== "env" &&
      (await this.cache.isLoginFresh(options.root, "cloudflare"))
    ) {
      const cached = await this.cache.getAccountId(options.root, "cloudflare");
      if (cached) {
        this.resolvedAccounts.set(token, cached);
        return cached;
      }
    }

    const accounts = await this.listAccounts(token);
    if (accounts.length === 0) {
      throw new AlephaError("No Cloudflare accounts found for this token.");
    }
    if (accounts.length > 1) {
      const list = accounts.map((a) => `  - ${a.id}  ${a.name}`).join("\n");
      throw new AlephaError(
        `Cloudflare token has access to ${accounts.length} accounts; set \`CLOUDFLARE_ACCOUNT_ID\` or the \`accountId\` option of \`cloudflare()\` to pick one:\n${list}`,
      );
    }

    const accountId = accounts[0].id;
    this.resolvedAccounts.set(token, accountId);
    if (origin !== "env") {
      await this.cache.recordLogin(options.root, "cloudflare", accountId);
    }
    return accountId;
  }

  /**
   * Every account the token can see.
   */
  protected async listAccounts(
    token: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const response = await globalThis.fetch(
      `${CloudflareCredentialSource.BASE}/accounts?per_page=50`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const text = await response.text();
    let json: {
      success?: boolean;
      result?: Array<{ id: string; name: string }>;
      errors?: Array<{ message: string }>;
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new AlephaError(
        `Cloudflare returned a non-JSON response (GET /accounts, HTTP ${response.status}): ${text.slice(0, 200).replace(/\s+/g, " ").trim() || "<empty body>"}`,
      );
    }
    if (!json.success) {
      throw new AlephaError(
        `Cloudflare API error (GET /accounts): ${(json.errors ?? []).map((it) => it.message).join(", ") || `HTTP ${response.status}`}`,
      );
    }
    return json.result ?? [];
  }

  /**
   * One environment variable. A method so a spec can answer for the machine.
   */
  protected readEnv(key: string): string | undefined {
    return process.env[key] || undefined;
  }

  /**
   * Whether a person is at a terminal who could finish `wrangler login`.
   */
  protected isInteractive(): boolean {
    return !!process.stdin.isTTY && !!process.stdout.isTTY;
  }
}
