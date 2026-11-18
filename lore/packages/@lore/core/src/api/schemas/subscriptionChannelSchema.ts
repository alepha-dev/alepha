import { type Infer, z } from "alepha";

/**
 * How a member is told of an event they subscribed to: in Lore's inbox, by
 * email, or both.
 */
export const subscriptionChannelSchema = z
  .enum(["inapp", "email"])
  .meta({ mode: "text" });

export type SubscriptionChannel = Infer<typeof subscriptionChannelSchema>;
