import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { ChatRoomController } from "../../../api/controllers/ChatRoomController.ts";
import type { ChatRoomResource } from "../../../schemas/index.ts";
import { newRoomFormSchema } from "../schemas/newRoomFormSchema.ts";

export interface NewRoomDialogProps {
  open: boolean;
  projectId: number;
  onOpenChange: (open: boolean) => void;
  onCreated: (room: ChatRoomResource) => void;
}

/**
 * The `+` above the room list (#E161, #Q3955): a name, and a Visibility,
 * Public or Private (#Q4484, where it was a Private switch).
 * The creator is the room's first member.
 */
const NewRoomDialog = (props: NewRoomDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<ChatRoomController>();

  const create = useAction<
    [values: { name: string; visibility: "public" | "private" }],
    void
  >(
    {
      handler: async (_context, values) => {
        const room = await api.createChatRoom({
          params: { projectId: props.projectId },
          body: {
            name: values.name,
            private: values.visibility === "private",
          },
        });
        props.onOpenChange(false);
        props.onCreated(room);
      },
      invalidates: [["chat-rooms", props.projectId]],
    },
    [api, props.projectId, props.onOpenChange, props.onCreated],
  );

  // Rebuilt for each opening: `useForm` anchors its values at mount.
  const form = useForm(
    {
      schema: newRoomFormSchema,
      initialValues: { name: "", visibility: "public" as const },
      handler: async (values) => {
        await create.run(values);
      },
    },
    [props.open],
  );
  const busy = create.loading;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("chat.room.new.title")}</DialogTitle>
          <DialogDescription>
            {tr("chat.room.new.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          {...form.props}
          className="flex flex-col gap-3"
          data-testid="chat-new-room-form"
        >
          <Control
            input={form.input.name}
            label={tr("chat.room.new.name")}
            description={tr("chat.room.new.nameHelp")}
            disabled={busy}
          />
          <Control
            input={form.input.visibility}
            label={tr("chat.room.new.visibility")}
            description={tr("chat.room.new.visibilityHelp")}
            select
            items={[
              { value: "public", label: tr("chat.room.new.public") },
              { value: "private", label: tr("chat.room.new.private") },
            ]}
            disabled={busy}
            inputProps={{ "data-testid": "chat-new-room-visibility" }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="minimal"
              disabled={busy}
              onClick={() => props.onOpenChange(false)}
            >
              {tr("chat.room.new.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {tr("chat.room.new.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewRoomDialog;
