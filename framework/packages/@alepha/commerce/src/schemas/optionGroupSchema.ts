import { type Infer, z } from "alepha";

/**
 * One choice a product offers: a name and the values it can take. In a file of
 * its own so the admin's browser bundle can read it.
 */
export const optionGroupSchema = z.object({
  name: z.text({ minLength: 1, maxLength: 64 }),
  values: z.array(z.text({ minLength: 1, maxLength: 64 })),
});

export type OptionGroup = Infer<typeof optionGroupSchema>;
