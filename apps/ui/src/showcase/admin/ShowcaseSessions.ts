import type { Page } from "alepha";
import type { SessionResource } from "alepha/api/users";

/**
 * Fake sessions, paged in memory.
 *
 * Typed as the real `SessionResource`, which is a PROJECTION of the sessions
 * entity rather than the entity itself: it deliberately omits `refreshToken`,
 * because that is a long-lived bearer credential and shipping it in an admin
 * response would hand over full impersonation. Borrowing the projection means
 * the showcase cannot accidentally invent a field the real API withholds.
 */
export class ShowcaseSessions {
  public paginate(query: ShowcaseSessionQuery): Page<SessionResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();

    const search = String(query.search ?? "").toLowerCase();
    if (search) {
      rows = rows.filter((r) =>
        (r.user?.email ?? "").toLowerCase().includes(search),
      );
    }
    if (query.country) {
      rows = rows.filter((r) => r.country === query.country);
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

  public countries(): string[] {
    return [
      ...new Set(
        this.rows()
          .map((r) => r.country)
          .filter(Boolean),
      ),
    ] as string[];
  }

  /**
   * One row per device kind so the device column renders all four of its
   * icons, and one expired session so the status column has both states.
   */
  public rows(): SessionResource[] {
    const seed: [string, string, string, string, string, string, number][] = [
      ["ada", "Ada", "Lovelace", "FR", "macOS", "Chrome", 0.3],
      ["alan", "Alan", "Turing", "GB", "Windows", "Firefox", 2],
      ["grace", "Grace", "Hopper", "US", "iOS", "Safari", 6],
      ["barbara", "Barbara", "Liskov", "US", "Android", "Chrome", 26],
      ["edsger", "Edsger", "Dijkstra", "NL", "Linux", "Firefox", 50],
      ["radia", "Radia", "Perlman", "US", "iPadOS", "Safari", 100],
    ];
    const devices = [
      "DESKTOP",
      "DESKTOP",
      "MOBILE",
      "MOBILE",
      "DESKTOP",
      "TABLET",
    ] as const;

    return seed.map(
      ([username, firstName, lastName, country, os, browser, hoursAgo], i) => ({
        id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`,
        version: 1,
        createdAt: this.at(hoursAgo + 24),
        updatedAt: this.at(hoursAgo),
        userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        // The last row is already past its expiry, so the listing has an
        // expired session to render as well as live ones.
        expiresAt: this.at(i === seed.length - 1 ? 12 : -720),
        lastUsedAt: this.at(hoursAgo),
        ip: `203.0.113.${10 + i}`,
        country,
        userAgent: { os, browser, device: devices[i] },
        user: {
          id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
          email: `${username}@alepha.dev`,
          username,
          firstName,
          lastName,
        },
      }),
    ) as SessionResource[];
  }

  /**
   * A fixed clock: `Date.now()` is banned repo-wide, and a moving one would
   * make every prerender emit different HTML.
   */
  protected at(hoursAgo: number): string {
    return new Date(
      Date.UTC(2026, 8, 5, 9, 0) - hoursAgo * 3_600_000,
    ).toISOString();
  }
}

export interface ShowcaseSessionQuery {
  page?: number;
  size?: number;
  sort?: string;
  search?: string;
  country?: string;
}
