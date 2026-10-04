import { z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { notes } from "../entities/notes.ts";
import { createNoteSchema } from "../schemas/createNoteSchema.ts";
import { noteSchema } from "../schemas/noteSchema.ts";

/**
 * The signed-in user's notes: the protected API the test app's loaders and
 * its form call cross-origin from the native shell.
 */
export class NoteController {
  protected readonly notes = $repository(notes);

  listNotes = $action({
    method: "GET",
    path: "/notes",
    use: [$secure()],
    description: "List the caller's notes, newest first",
    schema: {
      response: z.array(noteSchema),
    },
    handler: async ({ user }) => {
      return this.notes.findMany({
        where: { userId: { eq: user.id } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });
    },
  });

  createNote = $action({
    method: "POST",
    path: "/notes",
    use: [$secure()],
    description: "Write a note",
    schema: {
      body: createNoteSchema,
      response: noteSchema,
    },
    handler: async ({ body, user }) => {
      return this.notes.create({ userId: user.id, title: body.title });
    },
  });

  deleteNote = $action({
    method: "DELETE",
    path: "/notes/:id",
    use: [$secure()],
    description: "Delete one of the caller's notes",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, user }) => {
      // Owner-scoped lookup: someone else's note reads as missing.
      const note = await this.notes.findOne({
        where: { id: { eq: params.id }, userId: { eq: user.id } },
      });
      if (!note) throw new NotFoundError("Note not found");
      await this.notes.deleteById(note.id);
      return { ok: true };
    },
  });
}
