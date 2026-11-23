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
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { ProjectChannelController } from "../../../../../../api/controllers/ProjectChannelController.ts";
import { projectChannelFormSchema } from "../../../../../../api/schemas/projectChannelFormSchema.ts";
import type { ProjectChannelResource } from "../../../../../../api/schemas/projectChannelResourceSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface NotificationChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /**
   * The channel edited, or `undefined` to add one.
   */
  channel?: ProjectChannelResource;
  /**
   * The read the table draws from, refreshed once the channel is saved.
   */
  invalidates: unknown[];
  /**
   * A new webhook's signing secret, shown once by the caller after the
   * dialog closes.
   */
  onSecret: (secret: string) => void;
}

/**
 * Add a channel, or rename one and replace its URL (#Q3614, in a dialog
 * since #Q3912). A Discord URL is checked with a test message and never
 * shown again; a webhook's signing secret is handed to `onSecret` once.
 */
const NotificationChannelDialog = (props: NotificationChannelDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<ProjectChannelController>();
  const editing = props.channel;

  const save = useAction<
    [
      values: {
        kind?: "discord" | "webhook" | "chat";
        name?: string;
        url?: string;
        roomId?: string;
      },
    ],
    void
  >(
    {
      handler: async (_ctx, values) => {
        const url = values.url?.trim() || undefined;
        if (editing) {
          await api.updateProjectChannel({
            params: { projectId: props.projectId, id: editing.id },
            body: { name: values.name ?? "", ...(url ? { url } : {}) },
          });
          props.onOpenChange(false);
          return;
        }
        const kind = values.kind ?? "discord";
        const created = await api.createProjectChannel({
          params: { projectId: props.projectId },
          body:
            kind === "chat"
              ? // Named after its room by the server (#Q4187).
                { kind, roomId: values.roomId ?? "" }
              : { kind, name: values.name ?? "", url: url ?? "" },
        });
        props.onOpenChange(false);
        if (created.secret) props.onSecret(created.secret);
      },
      invalidates: [props.invalidates],
    },
    [api, props.projectId, editing, props.onOpenChange, props.onSecret],
  );

  // Rebuilt for each opening and each channel: `useForm` anchors its values
  // at mount.
  const form = useForm(
    {
      schema: projectChannelFormSchema,
      initialValues: {
        kind:
          editing?.kind === "webhook" || editing?.kind === "chat"
            ? editing.kind
            : "discord",
        name: editing?.name ?? "",
        url: "",
      },
      handler: async (values) => {
        await save.run(values);
      },
    },
    [props.open, editing?.id],
  );
  const values = useFormValues(form);
  const busy = save.loading;
  const kind = editing ? editing.kind : values.kind;
  const webhook = kind === "webhook";
  // A chat room (#Q4052): a room picker instead of a URL.
  const chat = kind === "chat";
  const rooms = useQuery(
    {
      key: ["channel-rooms", props.projectId],
      enabled: props.open && chat && !editing,
      handler: () =>
        api.listProjectChannelRooms({
          params: { projectId: props.projectId },
        }),
    },
    [api, props.projectId, props.open, chat, editing],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? tr("notifications.channels.editTitle", {
                  args: [editing.name],
                })
              : tr("notifications.channels.add")}
          </DialogTitle>
          <DialogDescription>
            {chat
              ? tr("notifications.channels.chatHelp")
              : webhook
                ? tr("notifications.channels.webhookHelp")
                : tr("notifications.channels.discordHelp")}
          </DialogDescription>
        </DialogHeader>
        <form
          {...form.props}
          className="flex flex-col gap-3"
          data-testid="notification-channel-form"
        >
          {!editing && (
            <Control
              input={form.input.kind}
              label={tr("notifications.channels.kind")}
              select
              items={[
                {
                  value: "discord",
                  label: tr("notifications.channels.kind.discord"),
                },
                {
                  value: "webhook",
                  label: tr("notifications.channels.kind.webhook"),
                },
                {
                  value: "chat",
                  label: tr("notifications.channels.kind.chat"),
                },
              ]}
              disabled={busy}
            />
          )}
          {/* A room channel is named after its room (#Q4187). */}
          {!chat && (
            <Control
              input={form.input.name}
              label={tr("notifications.channels.name")}
              disabled={busy}
            />
          )}
          {chat ? (
            !editing && (
              <Control
                input={form.input.roomId}
                label={tr("notifications.channels.room")}
                select
                items={(rooms.data?.items ?? []).map((room) => ({
                  value: room.id,
                  label: `# ${room.name}`,
                }))}
                disabled={busy || rooms.loading}
              />
            )
          ) : (
            <Control
              input={form.input.url}
              label={
                editing
                  ? tr("notifications.channels.replaceUrl")
                  : webhook
                    ? tr("notifications.channels.webhookUrl")
                    : tr("notifications.channels.discordUrl")
              }
              disabled={busy}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="minimal"
              disabled={busy}
              onClick={() => props.onOpenChange(false)}
            >
              {tr("notifications.channels.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={busy}
              data-testid="notification-channel-save"
            >
              {tr("notifications.channels.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NotificationChannelDialog;
