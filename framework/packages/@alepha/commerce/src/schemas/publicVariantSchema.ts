import { type Infer, z } from "alepha";

/**
 * A variant as a storefront draws it: which options it is, what it costs, and
 * what may still be sold. Spelled out like `publicProductSchema`, and for the
 * same reason.
 */
export const publicVariantSchema = z.object({
  id: z.uuid(),
  options: z.record(z.text(), z.text()),
  price: z.integer(),
  /**
   * Struck through beside the price: only ever higher than it.
   */
  compareAtPrice: z.integer().optional(),
  image: z.text({ maxLength: 500 }).optional(),
  available: z.integer(),
});

export type PublicVariant = Infer<typeof publicVariantSchema>;
