import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { pulseApps } from "./pulseApps.ts";

/**
 * One distinct failure in one app, and everything seen of it so far.
 *
 * The unit Pulse actually stores. Individual occurrences are never kept: a
 * crash loop is one fact with a count, and storing it a thousand times would
 * cost a thousand times more to learn the same thing.
 *
 * `fingerprint` comes from `@alepha/telemetry/fingerprint`, computed identically
 * by the app that sends, this table, and the forwarder that hands groups to
 * Lore. It survives a deploy: bundle hashes and line numbers are normalised
 * away, so a bug that is not fixed keeps its history instead of reappearing as
 * new after every release.
 *
 * `stackSample` is the FIRST occurrence's stack, not the latest. The newest
 * sample of a recurring error is rarely the informative one, and letting it
 * drift means the recorded stack no longer matches the recorded `firstSeenAt`.
 */
export const errorGroups = $entity({
  name: "error_groups",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    appId: db.ref(z.uuid(), () => pulseApps.cols.id, { onDelete: "cascade" }),
    fingerprint: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    message: z.string().max(2000),
    stackSample: z.string().max(4096),
    sourceUrl: z.string().max(2000),
    /** Release the error was first seen in, when the app reports one. */
    release: z.string().max(200).optional(),
    origin: db.default(
      z.enum(["client", "server"]).meta({ mode: "text" }),
      "client",
    ),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    count: db.default(z.integer().min(1), 1),
    /**
     * Last time this group was handed to Lore, or absent if never.
     *
     * Drives the forwarder's window: only groups touched since their last
     * forward are sent, so a quiet group costs nothing to keep.
     */
    forwardedAt: z.string().optional(),
  }),
  indexes: [
    { columns: ["appId", "fingerprint"], unique: true },
    { columns: ["appId", "lastSeenAt"] },
  ],
});

export type ErrorGroup = Static<typeof errorGroups.schema>;
export type ErrorGroupInsert = Static<typeof errorGroups.insertSchema>;
