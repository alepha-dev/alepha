import { z } from "alepha";

/**
 * The body of `POST /notes`.
 */
export const createNoteSchema = z.object({
  title: z.text({ minLength: 1, maxLength: 120 }).meta({ title: "Title" }),
});
