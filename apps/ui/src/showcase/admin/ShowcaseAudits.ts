import type { Page } from "alepha";
import type { AuditResource } from "alepha/api/audits";

/**
 * A fake audit log, paged and filtered in memory.
 *
 * The rows are typed as the REAL `AuditResource`, so a column added to the
 * entity upstream stops this file from compiling instead of quietly rendering
 * a blank cell in the showcase.
 */
export class ShowcaseAudits {
  /**
   * The `type:action` pairs `AdminAudits` loads to populate its filter.
   *
   * ⚠️ The component swallows a failure here (`.catch(() => {})`), so an
   * absent fixture shows an empty filter rather than an error. Derived from
   * the rows so the two can never disagree.
   */
  public actionPairs(): { type: string; action: string }[] {
    const seen = new Set<string>();
    const pairs: { type: string; action: string }[] = [];
    for (const row of this.rows()) {
      const key = `${row.type}:${row.action}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ type: row.type, action: row.action });
    }
    return pairs;
  }

  public paginate(query: ShowcaseAuditQuery): Page<AuditResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();

    if (query.type) {
      const types = String(query.type).split(",");
      rows = rows.filter((r) => types.includes(r.type));
    }
    if (query.action) {
      const actions = String(query.action).split(",");
      rows = rows.filter((r) => actions.includes(r.action));
    }
    if (query.layer === "app") {
      rows = rows.filter((r) => !r.scopeType);
    } else if (query.layer === "scoped") {
      rows = rows.filter((r) => !!r.scopeType);
    }
    if (query.success !== undefined) {
      rows = rows.filter((r) => r.success === query.success);
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
   * Deterministic, and newest first the way the real endpoint sorts.
   *
   * A fixed epoch rather than a relative one: `Date.now()` is banned repo-wide,
   * and a moving dataset would also make every prerender emit different HTML.
   */
  public rows(): AuditResource[] {
    const seed: [string, string, string, string, boolean][] = [
      ["user", "login", "Signed in with a password", "ada@alepha.dev", true],
      [
        "user",
        "login",
        "Rejected: wrong password",
        "mallory@alepha.dev",
        false,
      ],
      [
        "user",
        "update",
        "Changed their display name",
        "grace@alepha.dev",
        true,
      ],
      ["project", "create", "Created project Aurora", "ada@alepha.dev", true],
      [
        "project",
        "update",
        "Renamed project to Aurora II",
        "alan@alepha.dev",
        true,
      ],
      [
        "project",
        "delete",
        "Deleted project Basilisk",
        "grace@alepha.dev",
        true,
      ],
      ["key", "create", "Issued an API key for CI", "alan@alepha.dev", true],
      ["key", "revoke", "Revoked the CI key", "ada@alepha.dev", true],
      [
        "file",
        "upload",
        "Uploaded quarterly-report.pdf",
        "barbara@alepha.dev",
        true,
      ],
      ["file", "delete", "Deleted a stale export", "barbara@alepha.dev", true],
      ["settings", "update", "Turned registration off", "ada@alepha.dev", true],
      ["job", "trigger", "Ran sendDigest by hand", "alan@alepha.dev", true],
      [
        "job",
        "trigger",
        "Failed: SMTP refused the connection",
        "alan@alepha.dev",
        false,
      ],
      ["user", "delete", "Removed a disabled account", "ada@alepha.dev", true],
    ];

    // `id` and `createdAt` are STRINGS on the wire, not a bigint and a Date:
    // the entity declares `db.primaryKey(z.bigint())` and `db.createdAt()`,
    // and both serialize to text. Borrowing the real `AuditResource` type is
    // what surfaced that, rather than the showcase rendering "[object Object]"
    // in a date column.
    return seed.map(([type, action, description, userEmail, success], i) => ({
      id: String(1000 + seed.length - i),
      createdAt: new Date(
        Date.UTC(2026, 8, 4, 18, 0) - i * 37 * 60_000,
      ).toISOString(),
      organizationId: undefined,
      // Half the rows carry a scope so the layer filter has both sides to
      // show; the app-level rows leave it unset.
      scopeType: i % 3 === 0 ? "project" : undefined,
      scopeId:
        i % 3 === 0 ? `prj_${String(i + 1).padStart(3, "0")}` : undefined,
      type,
      action,
      severity: success ? "info" : "warning",
      userId: undefined,
      userRealm: "showcase",
      userEmail,
      resourceType: type,
      resourceId: `${type}_${String(i + 1).padStart(3, "0")}`,
      description,
      metadata: { source: "showcase" },
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      sessionId: undefined,
      requestId: `req_${String(i + 1).padStart(6, "0")}`,
      success,
      errorMessage: success ? undefined : "The operation was refused.",
      // Every fourth row is a coalesced burst (#1872), so the admin table's
      // count badge has something to draw. `updatedAt` is what gives the row
      // its span, and it is absent on the rows standing for one event -
      // which is what the badge's own absence has to look like.
      eventCount: i % 4 === 0 ? 3 : 1,
      updatedAt:
        i % 4 === 0
          ? new Date(
              Date.UTC(2026, 8, 4, 18, 0) - i * 37 * 60_000 + 4 * 60_000,
            ).toISOString()
          : undefined,
    })) as AuditResource[];
  }
}

export interface ShowcaseAuditQuery {
  page?: number;
  size?: number;
  sort?: string;
  type?: string;
  action?: string;
  layer?: string;
  success?: boolean;
}
