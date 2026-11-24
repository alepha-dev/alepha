import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { displayName, type I18n, type ProjectUser } from "@lore/core/web";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { roomInviteFormSchema } from "../schemas/roomInviteFormSchema.ts";

export interface RoomInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The project's people who are not in the room yet.
   */
  invitable: ProjectUser[];
  /**
   * Invites one; resolves `true` once it happened, and the dialog closes.
   */
  onInvite: (userId: string) => Promise<boolean>;
  busy: boolean;
}

/**
 * The members panel's `+` (#Q4267): choose a project member, invite them
 * into the private room.
 */
const RoomInviteDialog = (props: RoomInviteDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const form = useForm(
    {
      schema: roomInviteFormSchema,
      initialValues: { userId: undefined },
      handler: async (values) => {
        if (values.userId && (await props.onInvite(values.userId))) {
          props.onOpenChange(false);
        }
      },
    },
    [props.open],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("chat.room.invite")}</DialogTitle>
        </DialogHeader>
        <form
          {...form.props}
          className="flex flex-col gap-3"
          data-testid="chat-room-invite-form"
        >
          <Control
            input={form.input.userId}
            label={tr("chat.room.invite.member")}
            select
            triggerClassName="w-full"
            items={props.invitable.map((user) => ({
              value: user.id,
              label: displayName(user),
            }))}
            disabled={props.busy}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="minimal"
              disabled={props.busy}
              onClick={() => props.onOpenChange(false)}
            >
              {tr("chat.room.new.cancel")}
            </Button>
            <Button type="submit" disabled={props.busy}>
              {tr("chat.room.invite.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RoomInviteDialog;
