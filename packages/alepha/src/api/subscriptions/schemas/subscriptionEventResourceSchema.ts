import type { Static } from "alepha";
import { subscriptionEvents } from "../entities/subscriptionEvents.ts";

export const subscriptionEventResourceSchema = subscriptionEvents.schema;

export type SubscriptionEventResource = Static<
  typeof subscriptionEventResourceSchema
>;
