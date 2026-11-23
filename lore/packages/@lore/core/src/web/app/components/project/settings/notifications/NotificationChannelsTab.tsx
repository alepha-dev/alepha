import { Badge, useDialog } from "@alepha/ui";
import {
  DataTable,
  type DataTableFilterFields,
  type RowActionEntry,
} from "@alepha/ui/table";
import { z } from "alepha";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Bell,
  Hash,
  KeyRound,
  Mail,
  MessagesSquare,
  Pencil,
  Plus,
  Shapes,
  Trash2,
  Webhook,
} from "lucide-react";
import { useState } from "react";

import type { ProjectChannelController } from "../../../../../../api/controllers/ProjectChannelController.ts";
import type { ProjectChannelResource } from "../../../../../../api/schemas/projectChannelResourceSchema.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { canInProject } from "../../../../services/projectRank.ts";
import NotificationChannelDialog from "./NotificationChannelDialog.tsx";

export interface NotificationChannelsTabProps {
  /**
   * The test id of the list, when a host page mounts it twice.
   */
  testId?: string;
}

/**
 * The project's notification channels (#Q3614, #Q3891, #Q3900, a
 * `DataTable` since #Q3912): In-app and Email, a member's own, then the
 * project's Discord channels and webhook endpoints. Adding and editing one
 * happen in a dialog. A Discord URL is typed there and never shown again; a
 * webhook's URL is shown to whoever manages notifications, and its signing
 * secret once, on creation and on rotation. A webhook the framework
 * switched off says so on its row.
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
  if (!project) return null;
  const canManage = canInProject(project, "subscription:manage");
  const busy = remove.loading || rotate.loading;
  const items = channels.data?.items;
  const kinds = [...new Set((items ?? []).map((it) => it.kind))];
  const kindLabel = (kind: string) =>
    tr(`notifications.channels.kind.${kind}`, { default: kind });

  const fields = {
    search: { preset: "search" },
    kind: {
      schema: z.array(z.string()),
      label: tr("notifications.channels.kind"),
      icon: Shapes,
      mode: "default",
      column: "kind",
      items: kinds.map((value) => ({ value, label: kindLabel(value) })),
      control: { clearLabel: tr("notifications.channels.filter.anyKind") },
    },
  } satisfies DataTableFilterFields;

  const rowActions = (
    channel: ProjectChannelResource,
  ): RowActionEntry<ProjectChannelResource>[] =>
    channel.builtIn || !canManage
      ? []
      : [
          ...(channel.kind === "webhook"
            ? [
                {
                  icon: KeyRound,
                  label: tr("notifications.channels.rotate"),
                  disabled: () => busy,
                  onClick: () => void rotate.run(channel),
                },
              ]
            : []),
          // A room channel has nothing to edit: no URL, and its name
          // follows its room (#Q4187).
          ...(channel.kind === "chat"
            ? []
            : [
                {
                  icon: Pencil,
                  label: tr("notifications.channels.edit"),
                  disabled: () => busy,
                  onClick: () => setEditing(channel),
                },
              ]),
          {
            icon: Trash2,
            label: tr("notifications.channels.delete"),
            destructive: true,
            disabled: () => busy,
            onClick: () => void remove.run(channel),
          },
        ];

  const icon = (channel: ProjectChannelResource) => {
    const className = "text-muted-foreground size-4 shrink-0";
    if (channel.kind === "webhook") return <Webhook className={className} />;
    if (channel.kind === "email") return <Mail className={className} />;
    if (channel.kind === "inbox") return <Bell className={className} />;
    if (channel.kind === "chat")
      return <MessagesSquare className={className} />;
    return <Hash className={className} />;
  };

  return (
    // Bleeds over the settings body's padding: a `flat` table runs edge to
    // edge, as Hosts' does.
    <div
      className="-m-4 flex min-h-0 flex-1 flex-col md:-m-6"
      data-testid={props.testId ?? "notification-channels"}
    >
      {items !== undefined && (
        <DataTable<ProjectChannelResource, typeof fields>
          key={project.id}
          className="min-h-0 flex-1"
          flat
          persistenceKey={`lore.notification-channels.${project.id}`}
          data={items}
          pagination={false}
          rowKey={(channel) => channel.id}
          filters={{ fields }}
          filter={(channel, values) => {
            const search = values.search?.trim().toLowerCase();
            if (
              search &&
              ![channel.name, channel.url ?? "", kindLabel(channel.kind)]
                .join(" ")
                .toLowerCase()
                .includes(search)
            )
              return false;
            if (values.kind?.length && !values.kind.includes(channel.kind))
              return false;
            return true;
          }}
          actions={
            canManage
              ? [
                  {
                    icon: Plus,
                    label: tr("notifications.channels.add"),
                    primary: true,
                    disabled: busy,
                    onClick: () => setEditing(null),
                  },
                ]
              : []
          }
          rowActions={rowActions}
          emptyState={{ title: tr("notifications.channels.empty") }}
          noMatchState={{ title: tr("notifications.channels.emptyFilter") }}
          columns={{
            name: {
              label: tr("notifications.channels.name"),
              sortable: true,
              cell: (channel) => (
                <span
                  className="flex min-w-0 items-center gap-2"
                  data-testid={`notification-channel-${channel.builtIn ? channel.id : channel.name}`}
                >
                  {icon(channel)}
                  <span className="truncate font-medium">{channel.name}</span>
                </span>
              ),
            },
            kind: {
              label: tr("notifications.channels.kind"),
              sortable: true,
              sortValue: (channel) => kindLabel(channel.kind),
              cell: (channel) => (
                <Badge variant="outline">{kindLabel(channel.kind)}</Badge>
              ),
            },
            status: {
              label: tr("notifications.table.status"),
              cell: (channel) =>
                channel.builtIn ? (
                  <span className="text-muted-foreground text-sm">
                    {tr("notifications.channels.builtIn")}
                  </span>
                ) : channel.status === "disabled" ? (
                  <Badge variant="destructive">
                    {channel.disabledReason === "room_archived"
                      ? tr("notifications.channels.roomArchived")
                      : tr("notifications.channels.switchedOff")}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {tr("notifications.status.active")}
                  </span>
                ),
            },
            url: {
              label: tr("notifications.channels.url"),
              // A chat room channel's room in place of a URL (#Q4052).
              cell: (channel) =>
                channel.url || channel.roomName ? (
                  <span className="text-muted-foreground block max-w-80 truncate text-sm">
                    {channel.url ?? `# ${channel.roomName}`}
                  </span>
                ) : null,
            },
          }}
        />
      )}
      <NotificationChannelDialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        projectId={projectId}
        channel={editing ?? undefined}
        invalidates={key}
        onSecret={(secret) => void showSecret(secret)}
      />
    </div>
  );
};

export default NotificationChannelsTab;
