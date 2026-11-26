import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { monitorExpectSchema } from "../schemas/monitorExpectSchema.ts";
import { probeResultSchema } from "../schemas/probeResultSchema.ts";
import { appInstances } from "./appInstances.ts";

/**
 * An uptime check, owned by one app copy (#Q3657).
 *
 * The copy may have no deploy and no sigil: a project that only pings one
 * API creates an app with that address, and its monitor belongs there.
 * {@link appInstanceId} is optional in the column only for the monitors made
 * before the link existed; `UptimeMonitorOwners.adopt` gives each of them an
 * owner the first time the project's monitors or apps are read, and the API
 * creates no monitor without one.
 */
export const monitors = $entity({
  name: "monitors",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    createdAt: db.createdAt(),
    /**
     * The app copy this monitor watches. Deleting the copy deletes its
     * monitor.
     */
    appInstanceId: db.ref(z.uuid().optional(), () => appInstances.cols.id, {
      onDelete: "cascade",
    }),
    name: z.string().min(1).max(200),
    kind: z.enum(["http", "tcp", "cert", "push"]),
    target: z.string().max(2048),
    pushTokenHash: z.string().max(256).optional(),
    intervalSecs: db.default(z.integer().min(60).multipleOf(60), 60),
    timeoutSecs: db.default(z.integer().min(1).max(30), 10),
    confirmations: db.default(z.integer().min(1).max(100), 2),
    expect: db.default(monitorExpectSchema, {}),
    active: db.default(z.boolean(), true),
    status: db.default(z.enum(["up", "down", "pending", "paused"]), "pending"),
    statusSince: z.string(),
    failures: db.default(z.integer().min(0), 0),
    lastCheckedAt: z.string().optional(),
    lastPushedAt: z.string().optional(),
    lastResult: probeResultSchema.shape.result.optional(),
    nextCheckAt: z.string(),
    lastLatencyMs: z.integer().min(0).optional(),
    lastError: z.string().max(4096).optional(),
    certExpiresAt: z.string().optional(),
    /**
     * A host of the project, by slug, and one of its watched units
     * (#Q4424): while that unit is
     * starting or stopping (`activating`, `deactivating`, `reloading`), and
     * for at most {@link graceSecs} since it began, a failed check is held:
     * it does not count toward {@link confirmations} and opens no incident.
     * A deploy that restarts the app then pages nobody. A slug, as people
     * name hosts, resolved when a check fails: a deleted host simply stops
     * holding anything.
     */
    graceHost: z.string().max(64).optional(),
    graceUnit: z.string().max(200).optional(),
    graceSecs: db.default(z.integer().min(60).max(86_400), 1500),
  }),
  indexes: [
    { columns: ["pushTokenHash"], unique: true },
    { columns: ["projectId"] },
    { columns: ["appInstanceId"] },
    { columns: ["active", "nextCheckAt"] },
  ],
});

export type Monitor = Infer<typeof monitors.schema>;
