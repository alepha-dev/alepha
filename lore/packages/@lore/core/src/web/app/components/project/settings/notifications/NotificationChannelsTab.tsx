import { Badge, Button, useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Hash, Plus, Webhook } from "lucide-react";
import { useState } from "react";

import type { ProjectChannelController } from "../../../../../../api/controllers/ProjectChannelController.ts";
import { projectChannelFormSchema } from "../../../../../../api/schemas/projectChannelFormSchema.ts";
import type { ProjectChannelResource } from "../../../../../../api/schemas/projectChannelResourceSchema.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { canInProject } from "../../../../services/projectRank.ts";

export interface NotificationChannelsTabProps {
  /**
   * The test id of the list, when a host page mounts it twice.
   */
  testId?: string;
}

/**
 * The project's notification channels (#Q3614, #Q3891, #Q3900): In-app and
 * Email, a member's own, then the project's Discord channels and webhook
 * endpoints. A Discord URL is typed here and never shown again; a webhook's
 * URL is shown to whoever manages notifications, and its signing secret
 * once, on creation and on rotation. A webhook the framework switched off
 * says so on its row.
 */
const NotificationChannelsTab = (props: NotificationChannelsTabProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<ProjectChannelController>();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  // `undefined` closed, `null` adding, a channel when editing it.
  const [editing, setEditing] = useState<
    ProjectChannelResource | null | undefined
  >(undefined);
  const projectId = project?.id ?? 0;
  const key = ["notification-channels", projectId];
  const channels = useQuery(
    {
      key,
      enabled: !!project,
      handler: ({ signal }) =>
        api.listProjectChannels(
          { params: { projectId } },
          { request: { signal } },
        ),
    },
    [projectId],
  );
  const showSecret = async (secret: string | undefined) => {
    if (!secret) return;
    await dialog.alert({
      title: tr("notifications.channels.secretTitle"),
      description: `${tr("notifications.channels.secretHelp")}\n\n${secret}`,
    });
  };
  const save = useAction<
    [values: { kind?: "discord" | "webhook"; name: string; url?: string }],
    void
  >(
    {
      handler: async (_ctx, values) => {
        const url = values.url?.trim() || undefined;
        if (editing)
          await api.updateProjectChannel({
            params: { projectId, id: editing.id },
            body: { name: values.name, ...(url ? { url } : {}) },
          });
        else {
          const created = await api.createProjectChannel({
            params: { projectId },
            body: {
              kind: values.kind ?? "discord",
              name: values.name,
              url: url ?? "",
            },
          });
          await showSecret(created.secret);
        }
        setEditing(undefined);
      },
      invalidates: [key],
    },
    [api, projectId, editing],
  );
  const rotate = useAction<[channel: ProjectChannelResource], void>(
    {
      handler: async (_ctx, channel) => {
        if (
          !(await dialog.confirm({
            title: tr("notifications.channels.rotateTitle", {
              args: [channel.name],
            }),
            description: tr("notifications.channels.rotateDescription"),
            confirmLabel: tr("notifications.channels.rotate"),
          }))
        )
          return;
        const rotated = await api.rotateProjectChannelSecret({
          params: { projectId, id: channel.id },
        });
        await showSecret(rotated.secret);
      },
      invalidates: [key],
    },
    [api, projectId],
  );
  const remove = useAction<[channel: ProjectChannelResource], void>(
    {
      handler: async (_ctx, channel) => {
        if (
          !(await dialog.confirm({
            title: tr("notifications.channels.deleteTitle", {
              args: [channel.name],
            }),
            description: tr("notifications.channels.deleteDescription"),
            confirmLabel: tr("notifications.channels.delete"),
            destructive: true,
          }))
        )
          return;
        await api.deleteProjectChannel({
          params: { projectId, id: channel.id },
        });
      },
      invalidates: [key],
    },
    [api, projectId],
  );
  const form = useForm(
    {
      schema: projectChannelFormSchema,
      initialValues: {
        kind: editing?.kind === "webhook" ? "webhook" : "discord",
        name: editing?.name ?? "",
        url: "",
      },
      handler: async (values) => {
        await save.run(values);
      },
    },
    [editing?.id],
  );
  const values = useFormValues(form);
  if (!project) return null;
  const canManage =
    canInProject(project, "subscription:manage") ||
    canInProject(project, "automation:manage");
  const busy = save.loading || remove.loading || rotate.loading;
  const webhook = (editing ? editing.kind : values.kind) === "webhook";

  return (
    <div
      className="flex flex-col gap-4"
      data-testid={props.testId ?? "notification-channels"}
    >
      {canManage && editing === undefined && (
        <div>
          <Button onClick={() => setEditing(null)} disabled={busy}>
            <Plus className="size-4" />
            {tr("notifications.channels.add")}
          </Button>
        </div>
      )}
      {editing !== undefined && (
        <form
          {...form.props}
          className="bg-card flex flex-col gap-3 rounded-lg border p-4"
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
              ]}
              disabled={busy}
            />
          )}
          <Control
            input={form.input.name}
            label={tr("notifications.channels.name")}
            disabled={busy}
          />
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
          <p className="text-muted-foreground text-sm">
            {webhook
              ? tr("notifications.channels.webhookHelp")
              : tr("notifications.channels.discordHelp")}
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {tr("notifications.channels.save")}
            </Button>
            <Button
              type="button"
              variant="outlined"
              disabled={busy}
              onClick={() => setEditing(undefined)}
            >
              {tr("notifications.channels.cancel")}
            </Button>
          </div>
        </form>
      )}
      <ul className="bg-card divide-y rounded-lg border">
        {(channels.data?.items ?? []).map((channel) => (
          <li
            key={channel.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
            data-testid={`notification-channel-${channel.builtIn ? channel.id : channel.name}`}
          >
            {channel.kind === "webhook" ? (
              <Webhook className="text-muted-foreground size-4" />
            ) : (
              <Hash className="text-muted-foreground size-4" />
            )}
            <span className="font-medium">{channel.name}</span>
            <Badge variant="outline">
              {tr(`notifications.channels.kind.${channel.kind}`, {
                default: channel.kind,
              })}
            </Badge>
            {channel.status === "disabled" && (
              <Badge variant="destructive">
                {tr("notifications.channels.switchedOff")}
              </Badge>
            )}
            {channel.url && (
              <span className="text-muted-foreground min-w-0 truncate text-sm">
                {channel.url}
              </span>
            )}
            {channel.builtIn ? (
              <span className="text-muted-foreground ms-auto text-sm">
                {tr("notifications.channels.builtIn")}
              </span>
            ) : (
              canManage && (
                <span className="ms-auto flex flex-wrap gap-2">
                  {channel.kind === "webhook" && (
                    <Button
                      size="sm"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => void rotate.run(channel)}
                    >
                      {tr("notifications.channels.rotate")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => setEditing(channel)}
                  >
                    {tr("notifications.channels.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outlined"
                    intent="danger"
                    disabled={busy}
                    onClick={() => void remove.run(channel)}
                  >
                    {tr("notifications.channels.delete")}
                  </Button>
                </span>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NotificationChannelsTab;
