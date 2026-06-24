import { type Static, z } from "alepha";
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
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, {
      onDelete: "cascade",
    }),
    /** `sha256(errorName + ":" + firstStackLine + ":" + sigilId)`. */
    fingerprint: z.string().min(1).max(128),
    /** Error constructor name, e.g. "TypeError". Attacker-controlled. */
    name: z.string().max(200),
    /** Error message. Attacker-controlled. */
    message: z.string().max(2_000),
    /** Sanitized stack trace, truncated at 4 KB. Attacker-controlled. */
    stack: db.default(z.string().max(4_096), ""),
    /** Page URL the blight was thrown on. Attacker-controlled. */
    sourceUrl: db.default(z.string().max(2_000), ""),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    /** Incident count — how widely the blight has spread. */
    count: db.default(z.integer().min(1), 1),
    /**
     * Up to 10 hashed IPs (`sha256(ip + daily_salt)`) — breadth of spread.
     * NEVER raw IPs.
     */
    recentIps: db.default(z.array(z.string().max(128)).max(10), []),
    /** `open` | `resolved` | `quest:<questId>`. */
    status: db.default(z.string().max(50), "open"),
    /**
     * Where the blight originated.
     *
     * - `"client"` — reported by the embed bundle running in the partner page's
     *   browser (`error` / `unhandledrejection` events captured client-side).
     * - `"server"` — injected by the partner app's own backend via the sigil
     *   module's `server:onError` hook; the error never touched the browser.
     *
     * Defaults to `"client"` so all pre-existing blights (ingested before this
     * column was added) are correctly classified.
     */
    origin: db.default(
      z.enum(["client", "server"]).meta({ mode: "text" }),
      "client",
    ),
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
