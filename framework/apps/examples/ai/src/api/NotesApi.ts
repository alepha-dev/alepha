import { z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { noteEntity } from "./entities/noteEntity.ts";
import { createNoteSchema } from "./schemas/createNoteSchema.ts";
import { noteSchema } from "./schemas/noteSchema.ts";

/**
 * One read and one write. Both are ordinary `$action`s: the page calls them,
 * and so does the assistant, as the signed-in user and through the same
 * `$secure()`.
 */
export class NotesApi {
  protected readonly notes = $repository(noteEntity);

  public readonly listNotes = $action({
    method: "GET",
    path: "/notes",
    description: "List every note, newest first",
    use: [$secure()],
    schema: { response: z.array(noteSchema) },
    handler: () =>
      this.notes.findMany({
        orderBy: [
          { column: "createdAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        limit: 100,
      }),
  });

  public readonly createNote = $action({
    method: "POST",
    path: "/notes",
    description: "Add a note with the given text",
    use: [$secure()],
    schema: { body: createNoteSchema, response: noteSchema },
    handler: ({ body }) => this.notes.create({ text: body.text }),
  });
}
