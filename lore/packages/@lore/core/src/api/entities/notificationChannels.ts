import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * A channel a project posts notifications to (#Q3614, #Q3891), such as a
 * Discord channel: a subscription targets it instead of a member. Inbox and
 * Email are a member's, built in, and have no row. Renamed off automations
 * in #Q3891, rows and sealed URLs kept.
 *
 * `url` is sealed (`CredentialSealService.DISCORD_PURPOSE`): it is the whole
 * credential, so it is never returned, logged, put in an outbox row, a run
 * snapshot or a receipt. A subscription names the channel by `id`, and a
 * receipt says `discord:<id>`, since the name can change.
 *
 * `kind` leaves room for Slack or a generic webhook later.
 */
export const notificationChannels = $entity({
  name: "notification_channels",
  schema: z.object({
    /**
     * `discord-<uuid>`: within the channel id cap of 64 (#Q3613).
     */
    id: db.primaryKey(z.string().min(1).max(64)),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    kind: z.enum(["discord"]).meta({ mode: "text" }),
    name: z.string().min(1).max(64),
    url: z.string().max(4096),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [{ columns: ["projectId", "name"], unique: true }],
});

export type ProjectChannel = Infer<typeof notificationChannels.schema>;
