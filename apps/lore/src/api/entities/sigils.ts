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
 * A **sigil** is one environment of one application: `lore` in `production` is
 * a different sigil from `lore` in `staging`, and they report separately.
 *
 * That is the unit because it is the unit a question is asked about. "Did the
 * deploy break anything" is meaningless across environments, and an error
 * budget shared between staging and production is nobody's budget.
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
    /** Application name, e.g. `lore`. Free-form; the operator names it. */
    app: z.string().min(1).max(100),
    /** Stage, e.g. `production` / `staging`. Free-form for the same reason. */
    environment: z.string().min(1).max(50),
    /** Display label, defaulted to `<app> / <environment>` at creation. */
    label: z.string().min(1).max(200),
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
    { columns: ["projectId", "app", "environment"], unique: true },
    { columns: ["createdBy"] },
  ],
});

export type Sigil = Infer<typeof sigils.schema>;
export type SigilInsert = Infer<typeof sigils.insertSchema>;
