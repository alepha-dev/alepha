import { $inject, Alepha, z } from "alepha";
import { $storage } from "alepha/api/files";
import { $entity, $repository, db } from "alepha/orm";
import { $action } from "alepha/server";

/**
 * One row per note. Exists to prove the deploy provisioned a D1 database and
 * pointed the app at it: the row is written on one request and read back on
 * the next, so a binding that is missing or empty fails visibly.
 */
const noteEntity = $entity({
  name: "notes",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    label: z.text(),
    fileId: z.text(),
  }),
});

/**
 * The whole smoke test: a row in D1 and a blob in R2, written together and
 * read back separately.
 */
export class SmokeApi {
  protected readonly alepha = $inject(Alepha);

  notes = $repository(noteEntity);

  /**
   * A `$storage` is what makes the build declare `hasBucket`, which is what
   * makes the deploy provision an R2 bucket.
   */
  blobs = $storage({ maxSize: 1 });

  createNote = $action({
    method: "POST",
    path: "/notes",
    schema: {
      body: z.object({ label: z.string().min(1).max(200) }),
      response: z.object({
        id: z.string(),
        label: z.string(),
        fileId: z.string(),
      }),
    },
    handler: async ({ body }) => {
      const file = new File([`note body for ${body.label}`], "note.txt", {
        type: "text/plain",
      });
      const stored = await this.blobs.upload(file);
      const note = await this.notes.create({
        label: body.label,
        fileId: stored.id,
      });
      return { id: note.id, label: note.label, fileId: note.fileId };
    },
  });

  listNotes = $action({
    method: "GET",
    path: "/notes",
    schema: {
      response: z.object({
        count: z.integer(),
        items: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            fileId: z.string(),
            createdAt: z.string(),
          }),
        ),
      }),
    },
    handler: async () => {
      const items = await this.notes.findMany({ limit: 50 });
      return {
        count: items.length,
        items: items.map((it) => ({
          id: it.id,
          label: it.label,
          fileId: it.fileId,
          createdAt: String(it.createdAt),
        })),
      };
    },
  });

  readNoteBlob = $action({
    method: "GET",
    path: "/notes/:id/blob",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ fileId: z.string(), text: z.string() }),
    },
    handler: async ({ params }) => {
      const note = await this.notes.getById(params.id);
      const file = await this.blobs.download(note.fileId);
      return { fileId: note.fileId, text: await file.text() };
    },
  });

  health = $action({
    method: "GET",
    path: "/health",
    schema: {
      response: z.object({
        ok: z.boolean(),
        notes: z.integer(),
        now: z.string(),
        publicUrl: z.string(),
      }),
    },
    handler: async () => {
      const notes = await this.notes.count();
      return {
        ok: true,
        notes,
        now: new Date().toISOString(),
        publicUrl: String(this.alepha.env.PUBLIC_URL ?? ""),
      };
    },
  });
}
