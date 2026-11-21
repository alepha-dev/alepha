import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { subscriptionChannelSchema } from "../schemas/subscriptionChannelSchema.ts";
import { notificationChannels } from "./notificationChannels.ts";
import { projects } from "./projects.ts";

/**
 * Who is told when a project event happens (#E159, #Q3890): one event, an
 * optional filter (one host, app or monitor, by the catalog's filter field),
 * and a target: a member with the channels they are told on, or one of the
 * project's notification channels (#Q3891).
 *
 * - **`key` is the uniqueness.** `filter` is nullable, and both dialects
 *   treat nulls as distinct in a unique index, so the row's identity is
 *   computed into one text column (`EventSubscriptions.key`), the pattern
 *   `monitor_incidents.openKey` uses: a double click on a bell writes one
 *   row. The key holds no project id, so a project merge moves rows and
 *   joins a duplicate to the target's own.
 * - **A member mutes their own row** (`mutedAt`); a manager deletes it.
 * - **A member who leaves keeps their rows**, which deliver nothing while
 *   they are out and resume if they rejoin: delivery checks membership.
 */
export const eventSubscriptions = $entity({
  name: "event_subscriptions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    key: z.string().min(1).max(512),
    event: z.string().min(1).max(64),
    filter: z.string().max(255).optional(),
    // Nullable from the start so a channel target (#Q3891) is an added
    // column, not a table rebuild; the service requires it until then.
    memberId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The channel told instead of a member (#Q3891): exactly one of
     * `memberId` and `channelId` is set. Deleting the channel deletes the
     * row.
     */
    channelId: db.ref(
      z.string().max(64).optional(),
      () => notificationChannels.cols.id,
      { onDelete: "cascade" },
    ),
    channels: z.array(subscriptionChannelSchema).max(2),
    /**
     * A member's row skips the events their own action caused (#Q3916): a
     * report they filed themselves. Meaningless on a channel's row.
     */
    notMine: db.default(z.boolean(), false),
    /**
     * Skip the events a project member caused (#Q4055): a feedback bell
     * told only of outside reporters. A member's row or a channel's.
     */
    notMembers: db.default(z.boolean(), false),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    mutedAt: z.datetime().optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["projectId", "key"], unique: true },
    { columns: ["projectId", "event"] },
    { columns: ["memberId"] },
  ],
});

export type EventSubscription = Infer<typeof eventSubscriptions.schema>;
