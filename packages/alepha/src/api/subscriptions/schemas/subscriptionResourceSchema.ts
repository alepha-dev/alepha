import type { Static } from "alepha";
import { subscriptions } from "../entities/subscriptions.ts";

export const subscriptionResourceSchema = subscriptions.schema;

export type SubscriptionResource = Static<typeof subscriptionResourceSchema>;
