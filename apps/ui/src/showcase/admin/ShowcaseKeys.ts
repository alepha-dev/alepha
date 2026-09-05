import type { Page } from "alepha";
import type { AdminApiKeyResource } from "alepha/api/keys";

/**
 * Fake API keys, paged in memory.
 *
 * The resource carries `tokenPrefix` and `tokenSuffix` but never the token
 * itself: a key is shown in full exactly once, at creation. The fixtures keep
 * that shape rather than inventing a readable token, so the listing shows what
 * an operator would really see.
 */
export class ShowcaseKeys {
  public paginate(query: ShowcaseKeyQuery): Page<AdminApiKeyResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();
    if (!query.includeRevoked) {
      rows = rows.filter((r) => !r.revokedAt);
    }

    const offset = number * size;
    const content = rows.slice(offset, offset + size);
    const totalPages = Math.max(1, Math.ceil(rows.length / size));

    return {
      content,
      page: {
        number,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages,
        isEmpty: content.length === 0,
        isFirst: number === 0,
        isLast: number >= totalPages - 1,
      },
    };
  }

  /**
   * One revoked and one expiring key on purpose: the table renders a distinct
   * state for each, and a list of healthy keys would leave both unseen.
   */
  public rows(): AdminApiKeyResource[] {
    const seed: [string, string, string[], number | undefined, boolean][] = [
      [
        "CI pipeline",
        "Used by GitHub Actions to deploy",
        ["deploy"],
        undefined,
        false,
      ],
      [
        "Grafana",
        "Reads metrics every minute",
        ["metrics:read"],
        undefined,
        false,
      ],
      [
        "Partner sync",
        "Nightly catalogue import",
        ["catalogue:write"],
        -720,
        false,
      ],
      ["Laptop scratch", "A key someone made and forgot", [], undefined, true],
    ];

    return seed.map(([name, description, roles, expiresIn, revoked], i) => ({
      id: `00000000-0000-4000-b000-${String(i + 1).padStart(12, "0")}`,
      userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      user: {
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        email: ["ada", "alan", "grace", "edsger"][i] + "@alepha.dev",
      },
      name,
      description,
      tokenPrefix: `ak_${["ci", "graf", "sync", "tmp"][i]}`,
      tokenSuffix: ["9f2a", "41bd", "77c0", "0e13"][i],
      roles,
      createdAt: this.at(24 * (i + 3)),
      lastUsedAt: revoked ? undefined : this.at(i + 1),
      lastUsedIp: revoked ? undefined : `203.0.113.${20 + i}`,
      expiresAt: expiresIn === undefined ? undefined : this.at(expiresIn),
      revokedAt: revoked ? this.at(48) : undefined,
      usageCount: revoked ? 3 : [18422, 40311, 96, 0][i],
    })) as AdminApiKeyResource[];
  }

  protected at(hoursAgo: number): string {
    return new Date(
      Date.UTC(2026, 8, 5, 9, 0) - hoursAgo * 3_600_000,
    ).toISOString();
  }
}

export interface ShowcaseKeyQuery {
  page?: number;
  size?: number;
  sort?: string;
  includeRevoked?: boolean;
}
