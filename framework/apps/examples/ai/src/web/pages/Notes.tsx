import { Button, Card, CardContent } from "@alepha/ui";
import { AiChat, useAiContext } from "@alepha/ui/ai";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useState } from "react";

import type { NotesApi } from "../../api/NotesApi.ts";
import { createNoteSchema } from "../../api/schemas/createNoteSchema.ts";

/**
 * The notes, a form to add one, and the assistant. The page tells the
 * assistant what it shows and offers its form to `fillForm`, so "draft a
 * note about X" fills the field and leaves the saving to the user.
 */
const Notes = () => {
  const api = useClient<NotesApi>();
  const [chatOpen, setChatOpen] = useState(false);
  const notes = useQuery({ key: ["notes"], handler: () => api.listNotes() }, [
    api,
  ]);
  const create = useAction(
    {
      handler: async (_ctx, text: string) => {
        await api.createNote({ body: { text } });
      },
      invalidates: [["notes"]],
    },
    [api],
  );
  const form = useForm(
    {
      schema: createNoteSchema,
      handler: async (values) => {
        if ((await create.run(values.text)).ok) {
          form.reset();
        }
      },
    },
    [create.run],
  );

  useAiContext({
    page: "notes",
    data: { notes: (notes.data ?? []).map((note) => note.text) },
    form,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notes</h1>
        <Button intent="primary" onClick={() => setChatOpen(true)}>
          Ask the assistant
        </Button>
      </div>

      <form {...form.props} className="flex items-end gap-2">
        <div className="flex-1">
          <Control input={form.input.text} label="New note" />
        </div>
        <Button type="submit" disabled={create.loading}>
          Add
        </Button>
      </form>

      <ul data-testid="notes" className="flex flex-col gap-2">
        {(notes.data ?? []).map((note) => (
          <li key={note.id}>
            <Card>
              <CardContent>{note.text}</CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <AiChat
        open={chatOpen}
        onOpenChange={setChatOpen}
        invalidates={[["notes"]]}
      />
    </div>
  );
};

export default Notes;
