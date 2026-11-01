import { type Infer, z } from "alepha";

/**
 * A return as its customer reads it.
 */
export const publicReturnSchema = z.object({
  id: z.uuid(),
  createdAt: z.text(),
  orderId: z.uuid(),
  status: z.text(),
  lines: z.array(z.object({ orderItemId: z.uuid(), quantity: z.integer() })),
  reason: z.text({ maxLength: 500 }).optional(),
  note: z.text({ maxLength: 500 }).optional(),
});

export type PublicReturn = Infer<typeof publicReturnSchema>;
