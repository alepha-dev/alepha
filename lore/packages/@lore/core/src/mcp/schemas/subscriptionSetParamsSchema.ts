import { z } from "alepha";

import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * `subscription_set` (#Q3895): subscribe, mute, unmute or remove.
 */
export const subscriptionSetParamsSchema = projectParamsSchema.extend({
  verb: z
    .enum(["set", "mute", "unmute", "remove"])
    .describe(
      "`set` (the default) subscribes; `mute`, `unmute` and `remove` act on the subscription `id`.",
    )
    .optional(),
  id: z
    .uuid()
    .describe("The subscription, for mute, unmute and remove.")
    .optional(),
  event: z
    .string()
    .max(64)
    .describe("For set: the event, from event_catalog.")
    .optional(),
  filter: z
    .string()
    .max(255)
    .describe(
      "For set: only this host, app or monitor, by the event's filter field (a host id, an app name, a monitor id).",
    )
    .optional(),
  member_id: z
    .uuid()
    .describe(
      "For set: the member notified; yourself when absent. Another member needs subscription:manage.",
    )
    .optional(),
  channel_id: z
    .string()
    .max(64)
    .describe(
      "For set: a project channel notified instead of a member, from subscription_list. Needs subscription:manage.",
    )
    .optional(),
  channels: z
    .array(z.enum(["inapp", "email"]))
    .max(2)
    .describe("For set with a member: in the app, by email, or both (inapp).")
    .optional(),
  not_mine: z
    .boolean()
    .describe(
      "For set with a member: skip the events that member caused, such as a report they filed. Not on a channel.",
    )
    .optional(),
  not_members: z
    .boolean()
    .describe(
      "For set: skip the events a project member caused, so only outside reporters' feedback is told.",
    )
    .optional(),
});
