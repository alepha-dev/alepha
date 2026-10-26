import { type Infer, z } from "alepha";

/**
 * The body of a new note.
 */
export const createNoteSchema = z.object({
  text: z.text({ maxLength: 500, minLength: 1 }),
});

export type CreateNote = Infer<typeof createNoteSchema>;
