import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { users } from "./users.ts";

/**
 * An **outpost** is one machine that reports what it is hosting.
 *
 * The unit is the machine, not the application — that is what separates it from
 * a sigil. A sigil is one environment of one app telling Lore how it is doing;
 * an outpost is the supervisor underneath telling Lore what it has and what it
 * just did. They meet on `(app, environment)`, which is deliberately the key
 * both sides already use, and that join is where a deploy lands on top of an
 * error chart.
 *
 * **The machine pushes; Lore never polls it.** So this row holds no address to
 * call back on and no credential to call back with: the token below authorises
 * writing *into* Lore and nothing else. Stealing it lets someone lie about the
 * state of a fleet; it does not open a single door on the machine. That
 * asymmetry is the reason the push model was chosen over a pull.
 *
 * The credential is an `op_`-prefixed token shown once at creation and stored
 * as a hash, exactly like a sigil's. `tokenPrefix` exists so the UI can name a
 * key it cannot reconstruct.
 */
export const outposts = $entity({
  name: "outposts",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    /** Operator-chosen name, e.g. `OVH Bay`. A label, never an identity. */
    label: z.string().min(1).max(200),
    tokenHash: z.string().min(1).max(256),
    /** First characters of the token, so the UI can name it. */
    tokenPrefix: z.string().min(1).max(32),
    /**
     * What the machine says it is running, e.g. `bay 0.25.0`.
     *
     * Reported rather than configured: the answer to "which binary is on that
     * host" has to come from the host, or it is a note about what someone
     * intended to install.
     */
    agent: z.string().max(100).optional(),
    /**
     * The base domain the machine composes app subdomains against.
     *
     * Stored so Lore can render a link without guessing, and so a future
     * `adapter: "lore"` knows where a deploy would be routed. Never used to
     * reach the machine — nothing here does.
     */
    baseDomain: z.string().max(253).optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id),
    createdAt: db.createdAt(),
    /**
     * Last time this outpost reported anything.
     *
     * The same field a sigil has, and it does the same double duty: it drives
     * the "silent" badge, and a machine that stops reporting is a machine that
     * stopped — which makes this the cheapest dead-man's switch available.
     */
    lastSeenAt: z.string().optional(),
  }),
  indexes: [
    { columns: ["campaignId"] },
    { columns: ["tokenHash"], unique: true },
    { columns: ["createdBy"] },
  ],
});

export type Outpost = Infer<typeof outposts.schema>;
export type OutpostInsert = Infer<typeof outposts.insertSchema>;
