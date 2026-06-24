import { type Static, z } from "alepha";

export const notificationContactSchema = z.object({
  email: z.email().optional(),
  phoneNumber: z.e164().optional(),
  firstName: z.shortText().optional(),
  lastName: z.text({ size: "short" }).optional(),
  language: z.bcp47().optional(),
});

export type NotificationContact = Static<typeof notificationContactSchema>;
