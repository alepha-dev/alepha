import { z } from "alepha";

/**
 * A note as the API returns it.
 */
export const noteSchema = z.object({
  id: z.uuid(),
  title: z.text(),
  createdAt: z.datetime(),
});
