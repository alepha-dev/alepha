import { Button, Card, CardContent, useDialog } from "@alepha/ui";
import { AutoForm } from "@alepha/ui/form";
import { useAction, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useRouter } from "alepha/react/router";

import type { NoteController } from "../../api/controllers/NoteController.ts";
import { createNoteSchema } from "../../api/schemas/createNoteSchema.ts";

export interface NotesProps {
  notes: Array<{ id: string; title: string; createdAt: string }>;
}

/**
 * The signed-in user's notes: a list from the loader, a form that writes one,
 * and a delete behind a confirmation. Every write reloads the page so the
 * list is the loader's again.
 */
const Notes = (props: NotesProps) => {
  const api = useClient<NoteController>();
  const dialog = useDialog();
  const router = useRouter();

  const form = useForm({
    schema: createNoteSchema,
    handler: async (values) => {
      await api.createNote({ body: values });
      form.setInitialValues({ title: "" });
      await router.reload();
    },
  });

  const remove = useAction<[id: string], void>(
    {
      handler: async (id) => {
        const confirmed = await dialog.confirm({
          title: "Delete this note?",
          description: "It cannot be restored.",
          confirmLabel: "Delete",
          destructive: true,
        });
        if (!confirmed) return;
        await api.deleteNote({ params: { id } });
        await router.reload();
      },
    },
    [api, dialog, router],
  );

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Notes</h1>
      <AutoForm form={form} submitLabel="Add" />
      <ul className="space-y-2">
        {props.notes.map((note) => (
          <li key={note.id}>
            <Card>
              <CardContent className="flex items-center gap-3">
                <span className="flex-1">{note.title}</span>
                <Button
                  variant="outlined"
                  intent="danger"
                  size="sm"
                  disabled={remove.loading}
                  onClick={() => remove.run(note.id)}
                >
                  Delete
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {props.notes.length === 0 ? (
        <p className="text-muted-foreground">No notes yet.</p>
      ) : null}
    </section>
  );
};

export default Notes;
