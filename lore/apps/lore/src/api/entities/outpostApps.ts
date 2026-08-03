import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { outposts } from "./outposts.ts";

/**
 * One application instance as its machine last described it.
 *
 * **A snapshot, replaced on every report — not a series.** The machine sends
 * its whole world once a minute and this table is overwritten from it, so a row
 * always says "here is what is true now" and never "here is what was true at
 * 14:03". History that matters lives in `outpost_events`, which records the
 * things that *happened*; memory and uptime are gauges, and a gauge kept
 * forever is 1440 rows a day answering a question nobody asks.
 *
 * Keyed `(outpostId, app, environment)` because that triple is the identity on
 * both sides: it is Bay's instance key, and it is what a sigil is named after.
 * That is the whole join.
 */
export const outpostApps = $entity({
  name: "outpost_apps",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    outpostId: db.ref(z.uuid(), () => outposts.cols.id, {
      onDelete: "cascade",
    }),
    /** Application name as the machine knows it, e.g. `lore`. */
    app: z.string().min(1).max(100),
    /** Stage, e.g. `production`. */
    environment: z.string().min(1).max(50),
    /**
     * Every hostname this instance answers on, canonical first.
     *
     * A list because the machine keeps a list: an apex and its `www` are one
     * site, and a custom domain does not replace the subdomain an app was first
     * reachable at.
     */
    domains: db.default(z.array(z.string().max(253)).max(20), []),
    /** Release identifier the machine is currently serving. */
    release: z.string().max(100).optional(),
    /**
     * Whether the supervisor says the process is up.
     *
     * Asked of the supervisor per report rather than inferred from silence: an
     * app that is deliberately stopped and an app that crashed look identical
     * from the outside, and only the machine can tell them apart.
     */
    running: db.default(z.boolean(), false),
    /** Resident memory, as the cgroup charges it. */
    memoryBytes: z.integer().optional(),
    /**
     * Automatic restarts since the unit was last started by hand.
     *
     * The single most useful number the supervisor has: an app quietly
     * crash-looping looks perfectly healthy from outside.
     */
    restarts: db.default(z.integer(), 0),
    /** When the instance last answered a request, RFC3339. */
    lastRequestAt: z.string().optional(),
    /** When this row was last written from a report. */
    updatedAt: z.string(),
  }),
  indexes: [
    { columns: ["outpostId"] },
    { columns: ["outpostId", "app", "environment"], unique: true },
    // Read by the join that puts a deploy marker on a sigil's charts.
    { columns: ["app", "environment"] },
  ],
});

export type OutpostApp = Infer<typeof outpostApps.schema>;
export type OutpostAppInsert = Infer<typeof outpostApps.insertSchema>;
