import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { sigils } from "./sigils.ts";

/**
 * A deduplicated failure — the inbox Lore triages.
 *
 * One row per `(projectId, fingerprint)`, incremented on ingest rather than
 * stored per-occurrence: a crash loop is one fact with a count, not a log.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are entirely
 * attacker-controlled — they originate in an app's runtime, which handles input
 * from the public. Render them as escaped plain text only, never through
 * markdown or `dangerouslySetInnerHTML`, and treat them as data when they reach
 * an agent through MCP.
 */
export const projectErrors = $entity({
  name: "project_errors",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Which sigil reported it **most recently**.
     *
     * Not "which sigil filed it": a row is keyed `(projectId, fingerprint)`,
     * so one bug present in two enrolled apps is one row, and this column is
     * overwritten by whichever app reported last. That is
     * deliberate — "still happening, most recently over there" is the useful
     * fact for triage, and it is what the inbox's filter-by-sigil means. The
     * lossless per-app split lives in `sigil_error_groups`, keyed
     * `(sigilId, fingerprint)`.
     *
     * Nulled rather than cascaded on sigil deletion: deleting a sigil is how a
     * token is revoked, and that must not erase the bugs it reported.
     */
    sigilId: db.ref(z.uuid().optional(), () => sigils.cols.id, {
      onDelete: "set null",
    }),
    /**
     * `sha256(errorName + ":" + normalizedFirstFrame)`, computed by the
     * client with the shared helper from `@alepha/lore`.
     *
     * Survives a deploy: bundle hashes and line numbers are normalised away,
     * so a bug that is not fixed keeps its identity instead of reappearing as
     * new after every release.
     */
    fingerprint: z.string().min(1).max(128),
    name: z.string().max(200),
    message: z.string().max(2_000),
    stack: db.default(z.string().max(4_096), ""),
    sourceUrl: db.default(z.string().max(2_000), ""),
    /**
     * Where it came from: a sigil's `client` or `server`, or a `run` of a use
     * case whose criterion failed (#E153). `mode: "text"`: code-only.
     */
    origin: db.default(
      z.enum(["client", "server", "run"]).meta({ mode: "text" }),
      "client",
    ),
    /**
     * For a `run` error: the newest failing run and the criterion's key
     * (`C2`). Plain values: Ship never reads the run tables.
     */
    useCaseRunId: z.integer().optional(),
    criterionKey: z.string().max(10).optional(),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    /**
     * Total occurrences, summed across every batch received.
     */
    count: db.default(z.int64().min(1), 1),
    /**
     * `open`, `resolved`, or `quest:<id>` once promoted.
     */
    status: db.default(z.string().max(64), "open"),
    /**
     * When a member trusted this group, and who (#Q4233). Its text comes
     * from an ingest open to anyone, so no agent reads it before a member
     * did: a job key's error list holds trusted groups only, and refuses to
     * act on another. Kept when the group is reported again (same
     * fingerprint, same row); a new group starts untrusted.
     */
    trustedAt: z.string().optional(),
    trustedBy: z.uuid().optional(),
  }),
  indexes: [
    { columns: ["projectId", "fingerprint"], unique: true },
    { columns: ["projectId", "lastSeenAt"] },
  ],
});

export type ProjectError = Infer<typeof projectErrors.schema>;
export type ProjectErrorInsert = Infer<typeof projectErrors.insertSchema>;
