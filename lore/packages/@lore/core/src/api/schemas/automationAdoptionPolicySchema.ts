import { type Infer, z } from "alepha";

export const automationAdoptionPolicySchema = z.enum([
  "quest-reminders",
  "release-notifications",
]);
export type AutomationAdoptionPolicy = Infer<
  typeof automationAdoptionPolicySchema
>;
