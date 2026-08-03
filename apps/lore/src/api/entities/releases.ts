import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { outposts } from "./outposts.ts";
import { users } from "./users.ts";

/**
 * The states a release walks through, in order.
 *
 * `claimed` is the one that has to justify itself, since the others are just
 * the deploy narrating. Without it, a release nobody has picked up looks
 * exactly like one picked up by a machine that then died — and those two want
 * opposite handling: the first is waiting for an outpost, the second has to be
 * handed back. `claimedAt` plus a short expiry is what turns that distinction
 * into something a sweep can act on.
 *
 * `serving` and `failed` are terminal. A late report must not reopen a deploy
 * that already concluded.
 */
export const RELEASE_STATUSES = [
  "pending",
  "claimed",
  "pulling",
  "migrating",
  "serving",
  "failed",
] as const;

export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

/**
 * One artifact, and what became of it.
 *
 * The row **is** the synchronisation. `platform up` writes it, an outpost
 * claims it, and `up` watches it until it settles — there is no queue and no
 * callback, because a row both sides can read survives either of them
 * restarting mid-deploy. It is also why Lore never has to reach the machine:
 * the machine comes asking, and this is what it is told.
 *
 * **Content-addressed.** `sha256` is the identity of the bytes; `fileId` is
 * only where they happen to live today. An outpost already holding those bytes
 * skips the download, and "which version is running here" becomes a digest
 * comparison instead of trust in a directory name.
 */
export const releases = $entity({
  name: "releases",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Matches `outpost_apps.app` — the join that lets a deploy be found from
     * the machine that is hosting it, and vice versa.
     */
    app: z.string().min(1).max(100),
    environment: z.string().min(1).max(50),
    /** Release name, e.g. `2026-08-03-120000`. Unique per app + environment. */
    version: z.string().min(1).max(100),
    /** Digest of the tar.gz. Lowercase hex, always 64 characters. */
    sha256: z.string().length(64),
    /** The `alepha/api/files` row holding the bytes. */
    fileId: z.uuid(),
    sizeBytes: z.integer().min(0).optional(),
    status: db.default(
      z.enum([...RELEASE_STATUSES]).meta({ mode: "text" }),
      "pending",
    ),
    /**
     * Why it failed, in Bay's own words.
     *
     * Bay writes its errors for an operator — "rebuild with --target=bare",
     * "redeploy the app to migrate it". Stored and surfaced verbatim: rewriting
     * them throws away the only part that says what to do next.
     */
    failureReason: z.string().max(2000).optional(),
    /**
     * Which machine took it. Absent until claimed.
     *
     * `set null` rather than cascade: a release outlives the outpost that ran
     * it, and losing the deploy history of a machine because the machine was
     * retired is exactly backwards.
     */
    outpostId: db.ref(z.uuid().optional(), () => outposts.cols.id, {
      onDelete: "set null",
    }),
    claimedAt: z.string().optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["campaignId", "app", "environment", "version"], unique: true },
    { columns: ["campaignId", "status"] },
    { columns: ["outpostId"] },
  ],
});

export type Release = Infer<typeof releases.schema>;
export type ReleaseInsert = Infer<typeof releases.insertSchema>;
