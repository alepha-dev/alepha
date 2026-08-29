import { SIGIL_FEEDBACK_POSITIONS } from "@alepha/sigil";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * The capabilities a sigil may grant.
 */
export const SIGIL_KINDS = ["feedback", "blights", "beacon", "vitals"] as const;

export type SigilKind = (typeof SIGIL_KINDS)[number];

/**
 * A **sigil** is one app that reports into a project — nothing more than a
 * name and the credential that name reports with.
 *
 * The name is free-form and unique within the project, so how finely an
 * operator slices their world is their decision rather than the schema's: an
 * app that wants its staging traffic kept apart from production creates two
 * sigils and names them so, and one that does not, does not.
 *
 * The credential is a `sg_`-prefixed token shown once at creation and stored
 * as a hash. `tokenPrefix` exists so the UI can name a key it cannot
 * reconstruct.
 */
export const sigils = $entity({
  name: "sigils",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Display name of the app, e.g. `lore`. Free-form; the operator names it.
     */
    name: z.string().min(1).max(100),
    tokenHash: z.string().min(1).max(256),
    /**
     * First characters of the token, so the UI can name it.
     */
    tokenPrefix: z.string().min(1).max(32),
    /**
     * Capability buckets this sigil's ingest endpoint accepts.
     */
    kinds: db.default(z.array(z.string().max(50)).max(10), []),
    /**
     * @deprecated Frozen dead column — nothing reads or writes it.
     *
     * It held the corner this app's feedback button sits in, and shipped to
     * third-party pages through `/sigils/config`, which the reporting client
     * polled. That round trip was removed: a fetched config survives neither a
     * serverless isolate nor a prerender, so an app now declares the placement
     * in its own `SIGIL_CONFIG.feedbackButton`. The Lore-side setting outlived
     * the mechanism that delivered it and could not take effect at all.
     *
     * The column stays rather than being dropped, for the same reason
     * `projects.unlockedFeatures` and `quests.note` stay: `sigils` is the
     * CASCADE parent of the four analytics tables, and a `DROP COLUMN` that
     * drizzle turns into a table rebuild is the wipe bomb documented in
     * CLAUDE.md. It is also why the column is nullable with no `db.default` —
     * a nullable `ADD COLUMN` was the one shape that avoided a rebuild going
     * in, and staying put is the one shape that avoids one coming out.
     */
    feedbackPosition: z.enum(SIGIL_FEEDBACK_POSITIONS).optional(),
    /**
     * Where this app lives, as the operator typed it.
     *
     * The override half of the answer, and the reason there are two columns
     * rather than one: {@link lastSeenHost} is the address the app reports
     * from, which is right almost always and cannot be right for everyone. An
     * app served on an apex and a `www` has two, and whichever reported last
     * would win; an app that only ever uses the Feedback capability never
     * posts to the ingest at all and so reports none. Neither is a bug to fix
     * in the detection - they are cases where only the operator knows the
     * canonical answer.
     *
     * A full URL, not a host, because this one is typed: someone pinning an
     * address may well want a path on it, and refusing that would be refusing
     * the only thing the manual field is for.
     *
     * Optional, and deliberately without a `db.default` - the same shape
     * {@link feedbackPosition} carries, for the same reason. `sigils` is the
     * CASCADE parent of the four analytics tables, and a nullable `ADD COLUMN`
     * is the one shape that does not make drizzle rebuild the table. See
     * `apps/lore/CLAUDE.md`.
     */
    url: z.string().max(2048).optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id),
    createdAt: db.createdAt(),
    /**
     * Last time this sigil reported anything. Drives the "silent" badge.
     */
    lastSeenAt: z.string().optional(),
    /**
     * The host the last batch was sent from, as the app's own server named it.
     *
     * Stamped beside {@link lastSeenAt} on every accepted batch, from the
     * `host` field of the envelope. It is what makes the app's address
     * something Lore knows rather than something an operator maintains: an app
     * that moves domain says so on its next report, with nothing to update
     * here.
     *
     * A host, never a URL - the `Host` header carries no scheme, and the UI
     * renders `https://` in front of it rather than pretending to know.
     * {@link url} wins wherever it is set.
     *
     * Nullable for the same table-rebuild reason as {@link url}.
     */
    lastSeenHost: z.string().max(253).optional(),
  }),
  indexes: [
    { columns: ["projectId"] },
    { columns: ["tokenHash"], unique: true },
    { columns: ["projectId", "name"], unique: true },
    { columns: ["createdBy"] },
  ],
});

export type Sigil = Infer<typeof sigils.schema>;
export type SigilInsert = Infer<typeof sigils.insertSchema>;
