import { type Infer, z } from "alepha";

/**
 * A note as the API returns it.
 */
export const noteSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  text: z.text({ maxLength: 500 }),
});

export type Note = Infer<typeof noteSchema>;
