import { $inject } from "alepha";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbEntityNotFoundError } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { type GitHubState, githubStates } from "../entities/githubStates.ts";

/**
 * The `state` of a round trip through GitHub, signed and used once (#Q4360,
 * #Q4362).
 *
 * The value is `<row id>.<hmac>`: the HMAC (keyed on `APP_SECRET` under its
 * own label) refuses a forged value before any read, and the row binds it to
 * the member who started it, its purpose and its project, for ten minutes.
 * {@link claim} sets `usedAt` in the write's WHERE (no transaction in Lore,
 * #E69), so of two callbacks carrying the same state only one gets through.
 */
export class GitHubStateService {
  /**
   * The HMAC label: a state cannot be signed by another key space.
   */
  protected static readonly PURPOSE = "lore:github-state:v1";

  /**
   * How long a round trip through GitHub may take.
   */
  public static readonly TTL_MS = 10 * 60_000;

  protected readonly rows = $repository(githubStates);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly secrets = $inject(SecretProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  async issue(input: {
    purpose: GitHubState["purpose"];
    userId: string;
    projectId?: number;
    installationId?: number;
    repositoryIds?: number[];
    githubUserId?: number;
  }): Promise<string> {
    const now = this.dateTime.nowMillis();
    const row = await this.rows.create({
      id: crypto.randomUUID(),
      purpose: input.purpose,
      userId: input.userId,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.installationId !== undefined
        ? { installationId: input.installationId }
        : {}),
      ...(input.repositoryIds ? { repositoryIds: input.repositoryIds } : {}),
      ...(input.githubUserId !== undefined
        ? { githubUserId: input.githubUserId }
        : {}),
      expiresAt: new Date(now + GitHubStateService.TTL_MS).toISOString(),
    });
    // The table only grows by one row per round trip; a stale one goes the
    // next time anybody starts one.
    await this.rows.deleteMany({
      expiresAt: {
        lt: new Date(now - GitHubStateService.TTL_MS).toISOString(),
      },
    });
    return `${row.id}.${await this.sign(row.id)}`;
  }

  /**
   * Uses a state once, or refuses it.
   *
   * Refused alike, with one message, whatever is wrong (forged, expired,
   * used, another member, another project, another purpose): a callback
   * learns nothing from the refusal.
   */
  async claim(
    value: string | undefined,
    expected: {
      purpose: GitHubState["purpose"];
      userId: string;
      projectId?: number;
    },
  ): Promise<GitHubState> {
    const refused = new BadRequestError(
      "This GitHub link has expired or was already used. Start again from Lore.",
    );
    const [id, signature] = (value ?? "").split(".");
    if (!id || !signature) throw refused;
    if (!(await this.crypto.verifyHmac(id, signature, await this.key()))) {
      throw refused;
    }
    const now = this.dateTime.nowISOString();
    try {
      return await this.rows.updateOne(
        {
          id,
          purpose: expected.purpose,
          userId: expected.userId,
          ...(expected.projectId !== undefined
            ? { projectId: expected.projectId }
            : {}),
          usedAt: { isNull: true },
          expiresAt: { gt: now },
        },
        { usedAt: now },
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) throw refused;
      throw error;
    }
  }

  protected async sign(id: string): Promise<string> {
    return await this.crypto.hmac(id, await this.key());
  }

  protected async key(): Promise<string> {
    return await this.crypto.hmac(
      GitHubStateService.PURPOSE,
      this.secrets.secretKey,
    );
  }
}
