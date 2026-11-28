import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { sigils } from "./sigils.ts";
import { sigilSessions } from "./sigilSessions.ts";

/**
 * One visit: a run of page views by one visitor of one app, closed by 30
 * minutes without an event.
 *
 * Written once per ingest batch by `SigilIngestService.absorbViews`: a batch
 * joins the visitor's visit whose window it falls in by event time, or opens
 * one. What the visit says about where it came from (referrer, campaign) is
 * its entry view's, the only view that carries them; where it went is its
 * entry and exit paths. Bounce is a visit with exactly one view.
 *
 * Kept 400 days, pruned by `SigilJobs`. Declared bots get none.
 */
export const sigilVisits = $entity({
  name: "sigil_visits",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" }),
    sessionId: db.ref(z.uuid(), () => sigilSessions.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The first and last event of the visit, ISO 8601 UTC, by event time.
     */
    startedAt: z.string().max(32),
    lastSeenAt: z.string().max(32),
    /**
     * Page views in the visit. Zero only for a visit that holds an
     * engagement whose view landed outside every window.
     */
    views: z.integer().min(0),
    /**
     * Whether the visitor scrolled, clicked or stayed on a page.
     */
    engaged: z.boolean(),
    entryPath: z.string().max(512),
    exitPath: z.string().max(512),
    referrer: z.string().max(253),
    campaign: z.string().max(64),
    country: z.string().max(8),
    device: z.string().max(16),
    browser: z.string().max(16),
    os: z.string().max(16),
    /**
     * `human` today: declared bots get no visit. Kept for a later
     * `suspect` kind, classified from the network.
     */
    traffic: z.string().max(16),
    /**
     * `user` | `anon`: whether the visitor was signed in.
     */
    auth: z.string().max(8),
    /**
     * `AS13335 Cloudflare, Inc.`: the visitor's network, when the platform
     * gave one; null otherwise.
     */
    network: z.string().max(128).nullable().optional(),
  }),
  indexes: [
    { columns: ["sigilId", "startedAt"] },
    { columns: ["sessionId", "lastSeenAt"] },
    { columns: ["lastSeenAt"] },
  ],
});

export type SigilVisit = Infer<typeof sigilVisits.schema>;
