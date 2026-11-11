import { type Infer, z } from "alepha";

/**
 * The recipient's name and postal address, as `order.paid` and
 * `order.shipped` carry it: seven keys picked one by one from what the
 * checkout stored, nothing else. Never a phone number, though the checkout
 * stores one.
 */
export const webhookShippingAddressSchema = z.object({
  fullName: z.text({ maxLength: 200 }),
  line1: z.text({ maxLength: 200 }),
  line2: z.text({ maxLength: 200 }).optional(),
  locality: z.text({ maxLength: 120 }),
  region: z.text({ maxLength: 120 }).optional(),
  postalCode: z.text({ maxLength: 16 }),
  country: z.text({ minLength: 2, maxLength: 2 }),
});

export type WebhookShippingAddress = Infer<typeof webhookShippingAddressSchema>;
