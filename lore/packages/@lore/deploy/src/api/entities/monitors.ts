import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { monitorExpectSchema } from "../schemas/monitorExpectSchema.ts";

/**
 * Independent uptime targets. No app or sigil is required.
 */
export const monitors = $entity({
  name: "monitors",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    createdAt: db.createdAt(),
    name: z.string().min(1).max(200),
    kind: z.enum(["http", "tcp", "cert", "push"]),
    target: z.string().max(2048),
    intervalSecs: db.default(z.integer().min(60).multipleOf(60), 60),
    timeoutSecs: db.default(z.integer().min(1).max(30), 10),
    confirmations: db.default(z.integer().min(1).max(100), 2),
    expect: db.default(monitorExpectSchema, {}),
    active: db.default(z.boolean(), true),
    status: db.default(z.enum(["up", "down", "pending", "paused"]), "pending"),
    statusSince: z.string(),
    failures: db.default(z.integer().min(0), 0),
    lastCheckedAt: z.string().optional(),
    nextCheckAt: z.string(),
    lastLatencyMs: z.integer().min(0).optional(),
    lastError: z.string().max(4096).optional(),
    certExpiresAt: z.string().optional(),
  }),
  indexes: [{ columns: ["projectId"] }, { columns: ["active", "nextCheckAt"] }],
});

export type Monitor = Infer<typeof monitors.schema>;
