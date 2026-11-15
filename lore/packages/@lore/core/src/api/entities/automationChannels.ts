import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * A channel a project configures for its automations (#Q3614), such as a
 * Discord channel. Inbox and Email are built in and have no row.
 *
 * `url` is sealed (`CredentialSealService.DISCORD_PURPOSE`): it is the whole
 * credential, so it is never returned, logged, put in an outbox row, a run
 * snapshot or a receipt. A rule names the channel by `id`, and a receipt
 * says `discord:<id>`, since the name can change.
 *
 * `kind` leaves room for Slack or a generic webhook later.
 */
export const automationChannels = $entity({
  name: "automation_channels",
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

export type AutomationChannel = Infer<typeof automationChannels.schema>;
