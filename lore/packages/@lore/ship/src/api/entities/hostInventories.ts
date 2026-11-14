import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { hostInventoryAppSchema } from "../schemas/hostInventoryAppSchema.ts";
import { hostInventoryMachineSchema } from "../schemas/hostInventoryMachineSchema.ts";
import { hostInventoryStackSchema } from "../schemas/hostInventoryStackSchema.ts";
import { hosts } from "./hosts.ts";

/**
 * The last inventory a machine reported: one row per host, updated in
 * place.
 *
 * ## A table, never a column on `hosts`
 *
 * Two independent reasons, either sufficient on its own.
 *
 * `hosts` is a CASCADE parent (`host_commands`, `host_projects`, and
 * the `host_stats` dataset's reference). Adding a column to it is the
 * drizzle rebuild that "Migration safety on D1" in `apps/lore/AGENTS.md`
 * documents as the cascade wipe. A brand new table cannot rebuild an old one.
 *
 * And `listMyHosts` does a `findMany` over `hosts`, so a snapshot column
 * would deserialize every host's full app list on every account page load.
 *
 * ## One row per push, whatever the app count
 *
 * A row per instance per tick was the obvious design and is the expensive
 * one: folio #1152 measured D1 rows written at roughly three times what
 * requests cost. The snapshot is one JSON column updated in place, and
 * filtering it in memory is fine at this scale, since a host has tens of
 * instances rather than thousands.
 *
 * ## Two clocks, and only one of them is rendered
 *
 * `at` is the machine's own stamp and is a claim; `reportedAt` is Lore's
 * clock and is what the console shows. `HostStatsService` made this call
 * first and gave the reason: a host whose clock is hours off would otherwise
 * show "measured 3 hours ago" beside a `lastSeenAt` of a second ago.
 *
 * ⚠️ Anything added here later is optional with no `db.default`, the rule
 * `host_commands` follows, so the migration stays a plain
 * `ALTER TABLE ADD COLUMN`.
 */
export const hostInventories = $entity({
  name: "host_inventories",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * One row per host, and it dies with it. Unique because the row is a
     * snapshot rather than a history: a second row for one host would mean
     * two answers to "what is running on this machine".
     */
    hostId: db.ref(z.uuid(), () => hosts.cols.id, {
      onDelete: "cascade",
    }),
    /** The machine's own clock, kept as reported and never rendered. */
    at: z.string().max(40),
    /** Lore's clock: what "last reported 4 minutes ago" is counted from. */
    reportedAt: z.string().max(40),
    /**
     * Which Bay reported. Off the machine block so a list can name it without
     * parsing the JSON.
     */
    bayVersion: z.string().max(100).optional(),
    machine: hostInventoryMachineSchema,
    apps: z.array(hostInventoryAppSchema),
    /**
     * Denormalised, so the account list can say "7 apps" without
     * deserializing every host's app array.
     */
    appCount: z.integer().min(0),
    /**
     * The stack environments the machine runs (#E79). Absent on a row
     * written before stacks, and from a Bay that reports none.
     */
    stacks: z.array(hostInventoryStackSchema).optional(),
  }),
  indexes: [{ columns: ["hostId"], unique: true }],
});

export type HostInventory = Infer<typeof hostInventories.schema>;
