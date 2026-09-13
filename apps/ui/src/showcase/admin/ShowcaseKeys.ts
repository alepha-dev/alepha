import { $inject, type Page } from "alepha";
import type { AdminApiKeyResource, ApiKeyStatus } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";

/**
 * Fake API keys, paged in memory.
 *
 * The resource carries `tokenPrefix` and `tokenSuffix` but never the token
 * itself: a key is shown in full exactly once, at creation. The fixtures keep
 * that shape rather than inventing a readable token, so the listing shows what
 * an operator would really see.
 */
export class ShowcaseKeys {
  protected readonly dateTime = $inject(DateTimeProvider);

  public paginate(query: ShowcaseKeyQuery): Page<AdminApiKeyResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();
    // The server's rule: `status` wins, and without it `includeRevoked` is
    // the only switch.
    if (query.status?.length) {
      const wanted = query.status;
      rows = rows.filter((r) => wanted.includes(r.status));
    } else if (!query.includeRevoked) {
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
   * One key in each status on purpose: the table renders a distinct state for
   * each, and a list of healthy keys would leave the others unseen.
   */
  public rows(): AdminApiKeyResource[] {
    // [name, description, roles, expiresAt, revoked]
    const seed: [string, string, string[], string | undefined, boolean][] = [
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
        // From the real clock, not the fixture one: an "Expiring" badge beside
        // "5 days ago" would be the one state this row exists to show, wrong.
        this.dateTime.now().add(3, "day").toISOString(),
        false,
      ],
      ["Laptop scratch", "A key someone made and forgot", [], undefined, true],
      [
        "Old webhook",
        "Replaced by the partner sync",
        ["hooks"],
        this.at(240),
        false,
      ],
    ];

    return seed.map(([name, description, roles, expiresAt, revoked], i) => ({
      id: `00000000-0000-4000-b000-${String(i + 1).padStart(12, "0")}`,
      userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      user: {
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        email: ["ada", "alan", "grace", "edsger", "barbara"][i] + "@alepha.dev",
      },
      name,
      description,
      tokenPrefix: `ak_${["ci", "graf", "sync", "tmp", "hook"][i]}`,
      tokenSuffix: ["9f2a", "41bd", "77c0", "0e13", "5b88"][i],
      roles,
      permissions: [],
      createdAt: this.at(24 * (i + 3)),
      lastUsedAt: revoked ? undefined : this.at(i + 1),
      lastUsedIp: revoked ? undefined : `203.0.113.${20 + i}`,
      expiresAt,
      revokedAt: revoked ? this.at(48) : undefined,
      usageCount: revoked ? 3 : [18422, 40311, 96, 0, 1207][i],
      status: (["active", "active", "expiring", "revoked", "expired"] as const)[
        i
      ],
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
  status?: ApiKeyStatus[];
  includeRevoked?: boolean;
}
