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
    /** Display name of the app, e.g. `lore`. Free-form; the operator names it. */
    name: z.string().min(1).max(100),
    tokenHash: z.string().min(1).max(256),
    /** First characters of the token, so the UI can name it. */
    tokenPrefix: z.string().min(1).max(32),
    /** Capability buckets this sigil's ingest endpoint accepts. */
    kinds: db.default(z.array(z.string().max(50)).max(10), []),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id),
    createdAt: db.createdAt(),
    /** Last time this sigil reported anything. Drives the "silent" badge. */
    lastSeenAt: z.string().optional(),
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
