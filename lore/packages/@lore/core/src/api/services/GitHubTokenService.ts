import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { GitHubAppService } from "./GitHubAppService.ts";
import { GitHubClient } from "./GitHubClient.ts";

/**
 * A permission set an installation token is narrowed to, GitHub's own
 * names (`contents`, `pull_requests`, ...) and levels.
 */
export type GitHubPermissions = Record<string, "read" | "write">;

/**
 * An installation token, as a caller holds it: never stored, never logged.
 */
export interface GitHubInstallationToken {
  token: string;
  expiresAt: string;
  permissions: Record<string, string>;
}

/**
 * The App's bot, for jobs that commit (#Q4363).
 */
export interface GitHubBotIdentity {
  name: string;
  email: string;
}

/**
 * Installation tokens (#Q4363, epic #E177): one hour, one repository, the
 * permissions the caller names, and nothing else.
 *
 * ## Narrow, always
 *
 * Every token is minted for one repository (`repository_ids`) and one
 * permission set. Lore's own reads (the connect check, the backfill, an
 * author's permission) use {@link READ}; a workflow dispatch asks
 * {@link DISPATCH}; an agent job's sets are `AgentJobService`'s (#Q4365).
 *
 * ## Reused in memory, never persisted
 *
 * A token is reused until five minutes before it expires, per installation,
 * repository and permission set, in this process's memory (an isolate's on
 * workerd: a cold isolate mints again). Never written to the database, a
 * cache provider or a log; {@link forget} drops an installation's on
 * uninstall.
 */
export class GitHubTokenService {
  /**
   * Lore's own reads of a connected repository.
   */
  public static readonly READ: GitHubPermissions = {
    metadata: "read",
    contents: "read",
    pull_requests: "read",
    checks: "read",
    statuses: "read",
    actions: "read",
  };

  /**
   * A workflow dispatch, re-run or cancel (#Q4366): `actions: write` alone.
   */
  public static readonly DISPATCH: GitHubPermissions = { actions: "write" };

  /**
   * How long before its expiry a cached token stops being handed out.
   */
  public static readonly MARGIN_MS = 5 * 60_000;

  protected readonly client = $inject(GitHubClient);
  protected readonly apps = $inject(GitHubAppService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly cache = new Map<
    string,
    Promise<GitHubInstallationToken>
  >();
  protected bot?: Promise<GitHubBotIdentity>;

  async installationToken(input: {
    installationId: number;
    repositoryId: number;
    permissions: GitHubPermissions;
  }): Promise<GitHubInstallationToken> {
    const key = this.key(input);
    const cached = this.cache.get(key);
    if (cached) {
      const token = await cached.catch(() => undefined);
      if (token && this.fresh(token)) return token;
      this.cache.delete(key);
    }
    const minting = this.client.createInstallationToken(input.installationId, {
      repository_ids: [input.repositoryId],
      permissions: { ...input.permissions },
    });
    this.cache.set(key, minting);
    try {
      return await minting;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  /**
   * Drops every cached token of an installation: uninstalled, suspended, or
   * a repository removed from it.
   */
  forget(installationId: number): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${installationId}:`)) this.cache.delete(key);
    }
  }

  /**
   * The App's bot: `<slug>[bot]` and its noreply address, whose id is read
   * once from `GET /users/<slug>[bot]`.
   */
  async botIdentity(): Promise<GitHubBotIdentity> {
    this.bot ??= (async () => {
      const app = await this.apps.require();
      const name = `${app.slug}[bot]`;
      const id = await this.client.getUserId(name);
      return {
        name,
        email: id
          ? `${id}+${name}@users.noreply.github.com`
          : `${name}@users.noreply.github.com`,
      };
    })().catch((error) => {
      this.bot = undefined;
      throw error;
    });
    return await this.bot;
  }

  protected fresh(token: GitHubInstallationToken): boolean {
    const expires = Date.parse(token.expiresAt);
    return (
      Number.isFinite(expires) &&
      expires - GitHubTokenService.MARGIN_MS > this.dateTime.nowMillis()
    );
  }

  protected key(input: {
    installationId: number;
    repositoryId: number;
    permissions: GitHubPermissions;
  }): string {
    const permissions = Object.entries(input.permissions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, level]) => `${name}=${level}`)
      .join(",");
    return `${input.installationId}:${input.repositoryId}:${permissions}`;
  }
}
