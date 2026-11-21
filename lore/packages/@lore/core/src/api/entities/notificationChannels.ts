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
 * A `webhook` channel (#Q3900) is one endpoint of the framework's
 * `$webhook` module: its URL, signing secret, retries and health are the
 * framework's, and the row holds the endpoint's id. A `chat` channel
 * (#Q4052) is one of the project's chat rooms, by `roomId`.
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
    kind: z.enum(["discord", "webhook", "chat"]).meta({ mode: "text" }),
    name: z.string().min(1).max(64),
    /**
     * The sealed Discord URL. Empty for a webhook: its URL lives on its
     * endpoint.
     */
    url: z.string().max(4096),
    /**
     * A webhook channel's `webhook_endpoints` row (#Q3900), scoped
     * `project:<id>`. No foreign key: the endpoint table is the framework's.
     */
    endpointId: z.uuid().optional(),
    /**
     * A `chat` channel's room (#Q4052), posted into as Lore. No foreign key:
     * rooms are `@lore/chat`'s. A room is archived, never deleted; an
     * archived one takes nothing, and the channel says so.
     */
    roomId: z.string().max(64).optional(),
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
