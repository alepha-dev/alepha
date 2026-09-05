import type { Page } from "alepha";
import type { UserResource } from "alepha/api/users";

/**
 * A fake user directory, paged and filtered in memory.
 *
 * Typed as the REAL `UserResource`, so a column added to the users entity
 * upstream breaks this file instead of quietly blanking a cell.
 */
export class ShowcaseUsers {
  public roles(): { name: string; default?: boolean; description?: string }[] {
    return [
      { name: "owner", description: "Full access, including billing" },
      { name: "admin", description: "Manages users and settings" },
      { name: "member", default: true, description: "The default role" },
      { name: "viewer", description: "Read-only access" },
    ];
  }

  public paginate(query: ShowcaseUserQuery): Page<UserResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();

    const search = String(query.search ?? "").toLowerCase();
    if (search) {
      rows = rows.filter(
        (r) =>
          (r.email ?? "").toLowerCase().includes(search) ||
          (r.username ?? "").toLowerCase().includes(search) ||
          `${r.firstName ?? ""} ${r.lastName ?? ""}`
            .toLowerCase()
            .includes(search),
      );
    }
    if (query.enabled !== undefined) {
      rows = rows.filter((r) => r.enabled === query.enabled);
    }
    if (query.emailVerified !== undefined) {
      rows = rows.filter((r) => r.emailVerified === query.emailVerified);
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
   * Deterministic: fixed uuids and a fixed epoch, so the prerendered HTML is
   * stable across builds and the e2e suite has something to assert on.
   */
  public rows(): UserResource[] {
    const seed: [string, string, string, string[], boolean, boolean][] = [
      ["Ada", "Lovelace", "ada", ["owner"], true, true],
      ["Alan", "Turing", "alan", ["admin"], true, true],
      ["Grace", "Hopper", "grace", ["admin", "member"], true, true],
      ["Edsger", "Dijkstra", "edsger", ["member"], true, false],
      ["Barbara", "Liskov", "barbara", ["member"], true, true],
      ["Donald", "Knuth", "donald", ["viewer"], false, true],
      ["Margaret", "Hamilton", "margaret", ["member"], true, true],
      ["Ken", "Thompson", "ken", ["viewer"], true, false],
      ["Frances", "Allen", "frances", ["member"], true, true],
      ["Dennis", "Ritchie", "dennis", [], false, false],
      ["Radia", "Perlman", "radia", ["admin"], true, true],
      ["Leslie", "Lamport", "leslie", ["member"], true, true],
    ];

    return seed.map(
      ([firstName, lastName, username, roles, enabled, emailVerified], i) => ({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        version: 1,
        createdAt: new Date(Date.UTC(2026, 0, 1 + i, 9, 30)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 7, 1 + i, 14, 5)).toISOString(),
        realm: "showcase",
        username,
        email: `${username}@alepha.dev`,
        phoneNumber: undefined,
        roles,
        firstName,
        lastName,
        picture: undefined,
        enabled,
        emailVerified,
        lastLoginAt: enabled
          ? new Date(Date.UTC(2026, 8, 4, 8, 15 + i)).toISOString()
          : undefined,
        organizationId: undefined,
      }),
    ) as UserResource[];
  }
}

export interface ShowcaseUserQuery {
  page?: number;
  size?: number;
  sort?: string;
  search?: string;
  enabled?: boolean;
  emailVerified?: boolean;
}
