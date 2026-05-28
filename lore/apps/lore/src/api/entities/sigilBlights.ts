import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * A **blight** is a deduplicated uncaught exception captured from a sigil's
 * embedded site — one root cause, many incidents. The Blights ingestion
 * endpoint (`POST /sigils/:id/blights`) folds every reported `error` /
 * `unhandledrejection` into one row per `(sigilId, fingerprint)` pair:
 * a repeat of an already-known fingerprint bumps `count` + `lastSeenAt`
 * instead of inserting a new row.
 *
 * The `fingerprint` is `sha256(errorName + ":" + firstStackLine + ":" +
 * sigilId)` — stable across incidents of the same root cause, and scoped to
 * the sigil so two campaigns never collide.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are 100%
 * attacker-controlled (the embedding page's JS supplies them). They are
 * shown to the campaign owner — render them as escaped plain text only,
 * NEVER through markdown / `dangerouslySetInnerHTML`. The `stack` is
 * sanitized at ingestion (`?query=` stripped from frame URLs, truncated at
 * 4 KB) but is still untrusted text. See folio #12.
 *
 * Purely additive `CREATE TABLE` — D1-safe. The `cascade` on `sigilId` only
 * fires when the parent sigil is deleted (and sigils cascade from campaign
 * delete) — same chain as the other sigil-scoped tables.
 */
export const sigilBlights = $entity({
  name: "sigil_blights",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    sigilId: db.ref(t.uuid(), () => sigils.cols.id, {
      onDelete: "cascade",
    }),
    /** `sha256(errorName + ":" + firstStackLine + ":" + sigilId)`. */
    fingerprint: t.string({ minLength: 1, maxLength: 128 }),
    /** Error constructor name, e.g. "TypeError". Attacker-controlled. */
    name: t.string({ maxLength: 200 }),
    /** Error message. Attacker-controlled. */
    message: t.string({ maxLength: 2_000 }),
    /** Sanitized stack trace, truncated at 4 KB. Attacker-controlled. */
    stack: db.default(t.string({ maxLength: 4_096 }), ""),
    /** Page URL the blight was thrown on. Attacker-controlled. */
    sourceUrl: db.default(t.string({ maxLength: 2_000 }), ""),
    firstSeenAt: t.string(),
    lastSeenAt: t.string(),
    /** Incident count — how widely the blight has spread. */
    count: db.default(t.integer({ minimum: 1 }), 1),
    /**
     * Up to 10 hashed IPs (`sha256(ip + daily_salt)`) — breadth of spread.
     * NEVER raw IPs.
     */
    recentIps: db.default(
      t.array(t.string({ maxLength: 128 }), { maxItems: 10 }),
      [],
    ),
    /** `open` | `resolved` | `quest:<questId>`. */
    status: db.default(t.string({ maxLength: 50 }), "open"),
  }),
  indexes: [
    { columns: ["sigilId", "fingerprint"], unique: true },
    { columns: ["sigilId", "status"] },
  ],
});

export type SigilBlight = Static<typeof sigilBlights.schema>;
export type SigilBlightInsert = Static<typeof sigilBlights.insertSchema>;

/**
 * Prefix used in a blight's `status` column when it has been forwarded to a
 * quest: the status becomes `quest:<questId>`. Shared between the controller
 * (which writes / detects it) and the inbox UI (which strips it for display)
 * so the literal string and its length never drift apart.
 */
export const QUEST_STATUS_PREFIX = "quest:";
