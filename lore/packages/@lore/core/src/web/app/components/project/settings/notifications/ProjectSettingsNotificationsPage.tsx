import { Badge, useDialog } from "@alepha/ui";
import { Control, type SelectOption } from "@alepha/ui/form";
import {
  DataTable,
  type BulkAction,
  type DataTableFilterFields,
  type DataTableStatCard,
  readPersisted,
  type RowActionEntry,
  writePersisted,
} from "@alepha/ui/table";
import { z } from "alepha";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  BellOff,
  BellRing,
  CircleDot,
  Hash,
  Layers,
  Plus,
  Send,
  Shapes,
  Trash2,
  User,
  UsersRound,
  Webhook,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectChannelController } from "../../../../../../api/controllers/ProjectChannelController.ts";
import type { ProjectEventController } from "../../../../../../api/controllers/ProjectEventController.ts";
import type { SubscriptionController } from "../../../../../../api/controllers/SubscriptionController.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { canInProject } from "../../../../services/projectRank.ts";
import { useProjectUsers } from "../../../shared/useProjectUsers.ts";
import NotificationAddDialog from "./NotificationAddDialog.tsx";
import { NotificationLabels } from "./NotificationLabels.ts";
import type { NotificationTableRow } from "./notificationTableRow.ts";

/**
 * Settings > Notifications (#Q3892, a `DataTable` since #Q3912): who is
 * notified of what in the project, one row per subscription, grouped by
 * resource (or by recipient, or not at all).
 *
 * Whoever holds `subscription:manage` notifies any member ("tell her, not
 * me, when the app is down") or a channel; anyone else sees and changes
 * their own rows. Notify someone opens a dialog listing every event, an
 * unavailable one disabled with the switch that turns it on. Pause and
 * Stop are row actions, and bulk actions over a selection.
 */
const ProjectSettingsNotificationsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const auth = useAuth();
  const dialog = useDialog();
  const events = useClient<ProjectEventController>();
  const subscriptions = useClient<SubscriptionController>();
  const channelsApi = useClient<ProjectChannelController>();
  const [project] = useStore(currentProjectAtom);
  const users = useProjectUsers(!!project);
  const [adding, setAdding] = useState(false);
  const projectId = project?.id ?? 0;
  const manage = !!project && canInProject(project, "subscription:manage");
  const key = ["subscriptions", projectId];
  const me = auth.user?.id;

  const catalog = useQuery(
    {
      key: ["event-catalog", projectId],
      enabled: !!project,
      handler: ({ signal }) =>
        events.getProjectEventCatalog(
          { params: { projectId } },
          { request: { signal } },
        ),
    },
    [projectId],
  );
  const list = useQuery(
    {
      key,
      enabled: !!project,
      handler: ({ signal }) =>
        subscriptions.listSubscriptions(
          { params: { projectId } },
          { request: { signal } },
        ),
    },
    [projectId],
  );
  const channels = useQuery(
    {
      key: ["notification-channels", projectId],
      enabled: !!project && canInProject(project, "subscription:read"),
      handler: ({ signal }) =>
        channelsApi.listProjectChannels(
          { params: { projectId } },
          { request: { signal } },
        ),
      onError: () => {},
    },
    [projectId],
  );
  const filterResources = [
    ...new Set(
      (catalog.data?.items ?? []).flatMap((it) =>
        it.filter ? [it.filter.resource] : [],
      ),
    ),
  ];
  const filters = useQuery(
    {
      key: ["event-filters", projectId, filterResources.join(",")],
      enabled: !!project && filterResources.length > 0,
      handler: async ({ signal }) => {
        const entries = await Promise.all(
          filterResources.map(
            async (resource) =>
              [
                resource,
                (
                  await events.getProjectEventFilterOptions(
                    { params: { projectId, resource } },
                    { request: { signal } },
                  )
                ).items,
              ] as const,
          ),
        );
        return Object.fromEntries(entries) as Record<
          string,
          Array<{ value: string; label: string }>
        >;
      },
    },
    [projectId, filterResources.join(",")],
  );

  // Pause or resume, one row or a selection: the reader's own rows only.
  const mute = useAction<[rows: NotificationTableRow[], muted: boolean], void>(
    {
      handler: async (_ctx, rows, muted) => {
        for (const row of rows) {
          await subscriptions.muteSubscription({
            params: { projectId, id: row.id },
            body: { muted },
          });
        }
      },
      invalidates: [key],
    },
    [subscriptions, projectId],
  );
  const remove = useAction<[rows: NotificationTableRow[]], boolean>(
    {
      handler: async (_ctx, rows) => {
        if (
          !(await dialog.confirm({
            title:
              rows.length === 1
                ? tr("notifications.remove.title")
                : tr("notifications.remove.titleMany", {
                    args: [String(rows.length)],
                  }),
            description: tr("notifications.remove.description"),
            confirmLabel: tr("notifications.remove.confirm"),
            destructive: true,
          }))
        )
          return false;
        for (const row of rows) {
          await subscriptions.deleteSubscription({
            params: { projectId, id: row.id },
          });
        }
        return true;
      },
      invalidates: [key],
    },
    [subscriptions, projectId],
  );

  // The grouping, outside the table's filters: it arranges the rows and
  // narrows none of them. Empty is "No grouping", the select's placeholder
  // (#Q4054): clearing the selected value returns to it.
  // Remembered as the table's filters are (#Q4192): under the same
  // `persistenceKey`, with "none" for No grouping, since an empty value
  // reads back as "never chosen", which is By resource.
  const persistenceKey = `lore.notifications.${projectId}`;
  const storedGroup = readPersisted<string>(persistenceKey, "group");
  const grouping = useForm(
    {
      id: "notifications-grouping",
      schema: z.object({
        group: z.enum(["resource", "recipient"]).optional(),
      }),
      initialValues: {
        group:
          storedGroup === "none"
            ? undefined
            : storedGroup === "recipient"
              ? ("recipient" as const)
              : ("resource" as const),
      },
      handler: async () => {},
      onChange: (_key, value) =>
        writePersisted(persistenceKey, "group", value ?? "none"),
    },
    [persistenceKey],
  );
  const group = useFormValues(grouping).group;

  const nameOf = (id: string) => {
    const user = users.find((it) => it.id === id);
    if (!user) return tr("notifications.someone");
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    return name || user.username || user.email || tr("notifications.someone");
  };
  const catalogItems = catalog.data?.items ?? [];
  const channelItems = channels.data?.items ?? [];

  const rows = useMemo<NotificationTableRow[] | undefined>(() => {
    if (!list.data || !catalog.data) return undefined;
    return list.data.items.map((sub) => {
      const entry = catalogItems.find((it) => it.name === sub.event);
      const channel = sub.channelId
        ? channelItems.find((it) => it.id === sub.channelId)
        : undefined;
      const mine = !sub.channelId && sub.memberId === me;
      return {
        id: sub.id,
        subscription: sub,
        event: sub.event,
        eventLabel: entry
          ? NotificationLabels.event(tr, entry)
          : tr(`notifications.event.${sub.event}`, { default: sub.event }),
        resource: entry?.resource ?? "other",
        available: entry?.available ?? false,
        reason:
          entry && !entry.available
            ? NotificationLabels.reason(tr, entry)
            : undefined,
        recipient: sub.channelId
          ? `channel:${sub.channelId}`
          : `member:${sub.memberId ?? ""}`,
        recipientLabel: sub.channelId
          ? (channel?.name ?? sub.channelId)
          : mine
            ? tr("notifications.target.me")
            : nameOf(sub.memberId ?? ""),
        recipientKind: sub.channelId
          ? channel?.kind === "discord" || channel?.kind === "webhook"
            ? channel.kind
            : "channel"
          : "member",
        mine,
        filterLabel: sub.filter
          ? (filters.data?.[entry?.filter?.resource ?? ""]?.find(
              (it) => it.value === sub.filter,
            )?.label ?? sub.filter)
          : undefined,
        how: sub.channelId ? ["channel"] : sub.channels,
        status: sub.mutedAt ? "paused" : "active",
      };
    });
  }, [list.data, catalog.data, channels.data, filters.data, users, me, tr]);

  if (!project) return null;

  const all = rows ?? [];
  const busy = mute.loading || remove.loading;
  const available = catalogItems.filter((it) => it.available);
  const canRemove = (row: NotificationTableRow) => manage || row.mine;

  // Who may be notified: the reader alone, or, for a manager, every member
  // and every project channel.
  const targets: SelectOption[] = [
    { value: `member:${me ?? ""}`, label: tr("notifications.target.me") },
    ...(manage
      ? users
          .filter((user) => user.id !== me)
          .map((user) => ({
            value: `member:${user.id}`,
            label: nameOf(user.id),
          }))
      : []),
    ...(manage
      ? channelItems
          .filter((it) => !it.builtIn)
          .map((it) => ({ value: `channel:${it.id}`, label: it.name }))
      : []),
  ];
  // The Who filter offers whoever has a row, plus the reader.
  const recipients = [
    ...new Map(
      all.map((row) => [row.recipient, row.recipientLabel] as const),
    ).entries(),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) =>
      a.value === `member:${me}`
        ? -1
        : b.value === `member:${me}`
          ? 1
          : a.label.localeCompare(b.label),
    );
  const resources = NotificationLabels.groups(catalogItems).map(
    ([resource]) => resource,
  );
  const resourceLabel = (resource: string) =>
    tr(`notifications.resource.${resource}`, { default: resource });
  const howLabel = (how: string) =>
    how === "channel"
      ? tr("notifications.how.channel")
      : tr(`notifications.channel.${how}`, { default: how });

  const fields = {
    search: { preset: "search" },
    resource: {
      schema: z.array(z.string()),
      label: tr("notifications.filter.resource"),
      icon: Shapes,
      mode: "default",
      items: resources.map((value) => ({
        value,
        label: resourceLabel(value),
      })),
      control: { clearLabel: tr("notifications.filter.anyResource") },
    },
    recipient: {
      schema: z.string(),
      label: tr("notifications.filter.recipient"),
      icon: UsersRound,
      mode: "default",
      column: "recipient",
      items: recipients,
      hidden: recipients.length < 2,
      control: { clearLabel: tr("notifications.filter.anyRecipient") },
    },
    how: {
      schema: z.array(z.string()),
      label: tr("notifications.filter.how"),
      icon: Send,
      items: ["inapp", "email", "channel"].map((value) => ({
        value,
        label: howLabel(value),
      })),
      control: { clearLabel: tr("notifications.filter.anyHow") },
    },
    status: {
      schema: z.array(z.enum(["active", "paused"])),
      label: tr("notifications.filter.status"),
      icon: CircleDot,
      column: "status",
      optionLabel: (value: "active" | "paused") =>
        tr(`notifications.status.${value}`),
      control: { clearLabel: tr("notifications.filter.anyStatus") },
    },
  } satisfies DataTableFilterFields;

  const matches = (
    row: NotificationTableRow,
    values: {
      search?: string;
      resource?: string[];
      recipient?: string;
      how?: string[];
      status?: Array<"active" | "paused">;
    },
  ) => {
    const search = values.search?.trim().toLowerCase();
    if (
      search &&
      ![row.eventLabel, row.recipientLabel, row.filterLabel ?? "", row.event]
        .join(" ")
        .toLowerCase()
        .includes(search)
    )
      return false;
    if (values.resource?.length && !values.resource.includes(row.resource))
      return false;
    if (values.recipient && row.recipient !== values.recipient) return false;
    if (values.how?.length && !row.how.some((it) => values.how?.includes(it)))
      return false;
    if (values.status?.length && !values.status.includes(row.status))
      return false;
    return true;
  };

  const paused = all.filter((row) => row.status === "paused").length;
  const cards: DataTableStatCard[] = [
    {
      label: tr("notifications.counter.all"),
      value: String(all.length),
      icon: BellRing,
    },
    {
      label: tr("notifications.counter.mine"),
      value: String(all.filter((row) => row.mine).length),
      icon: User,
      filter: { recipient: `member:${me ?? ""}` },
    },
    {
      label: tr("notifications.counter.paused"),
      value: String(paused),
      icon: BellOff,
      tone: paused > 0 ? "warning" : undefined,
      filter: { status: ["paused"] },
    },
  ];

  const rowActions = (
    row: NotificationTableRow,
  ): RowActionEntry<NotificationTableRow>[] => [
    ...(row.mine
      ? [
          {
            icon: row.status === "paused" ? BellRing : BellOff,
            label:
              row.status === "paused"
                ? tr("notifications.unmute")
                : tr("notifications.mute"),
            disabled: () => busy,
            onClick: () => void mute.run([row], row.status === "active"),
          },
        ]
      : []),
    ...(canRemove(row)
      ? [
          {
            icon: Trash2,
            label: tr("notifications.remove.confirm"),
            destructive: true,
            disabled: () => busy,
            onClick: () => void remove.run([row]),
          },
        ]
      : []),
  ];

  const bulkActions: BulkAction<NotificationTableRow>[] = [
    {
      icon: BellOff,
      label: tr("notifications.mute"),
      visible: (selected) =>
        selected.some((row) => row.mine && row.status === "active"),
      count: (selected) =>
        selected.filter((row) => row.mine && row.status === "active").length,
      onClick: async (selected, ctx) => {
        const done = await mute.run(
          selected.filter((row) => row.mine && row.status === "active"),
          true,
        );
        if (done.ok) ctx.clearSelection();
      },
    },
    {
      icon: BellRing,
      label: tr("notifications.unmute"),
      visible: (selected) =>
        selected.some((row) => row.mine && row.status === "paused"),
      count: (selected) =>
        selected.filter((row) => row.mine && row.status === "paused").length,
      onClick: async (selected, ctx) => {
        const done = await mute.run(
          selected.filter((row) => row.mine && row.status === "paused"),
          false,
        );
        if (done.ok) ctx.clearSelection();
      },
    },
    {
      icon: Trash2,
      label: tr("notifications.remove.confirm"),
      destructive: true,
      visible: (selected) => selected.some(canRemove),
      count: (selected) => selected.filter(canRemove).length,
      onClick: async (selected, ctx) => {
        const done = await remove.run(selected.filter(canRemove));
        if (done.ok && done.value) ctx.clearSelection();
      },
    },
  ];

  const recipientIcon = (row: NotificationTableRow) =>
    row.recipientKind === "webhook" ? (
      <Webhook className="text-muted-foreground size-4 shrink-0" />
    ) : row.recipientKind === "member" ? (
      <User className="text-muted-foreground size-4 shrink-0" />
    ) : (
      <Hash className="text-muted-foreground size-4 shrink-0" />
    );

  return (
    // Bleeds over the settings body's padding: a `flat` table runs edge to
    // edge, as Hosts' does.
    <div
      className="-m-4 flex min-h-0 flex-1 flex-col md:-m-6"
      data-testid="notifications-settings"
    >
      {rows !== undefined && (
        <DataTable<NotificationTableRow, typeof fields>
          key={project.id}
          className="min-h-0 flex-1"
          flat
          persistenceKey={persistenceKey}
          data={rows}
          pagination={false}
          rowKey={(row) => row.id}
          filters={{ fields }}
          filter={(row, values) => matches(row, values)}
          summary={{ cards }}
          groupBy={
            group === undefined
              ? undefined
              : group === "resource"
                ? {
                    key: (row) => row.resource,
                    label: (value) => resourceLabel(value),
                    order: (a, b) =>
                      (resources.indexOf(a) + 1 || resources.length + 1) -
                      (resources.indexOf(b) + 1 || resources.length + 1),
                  }
                : {
                    key: (row) => row.recipient,
                    label: (_value, items) => (
                      <span className="flex items-center gap-2">
                        {items[0] && recipientIcon(items[0])}
                        {items[0]?.recipientLabel}
                      </span>
                    ),
                    order: (a, b) =>
                      a === `member:${me}`
                        ? -1
                        : b === `member:${me}`
                          ? 1
                          : a.localeCompare(b),
                  }
          }
          defaultSort={{ field: "event", direction: "asc" }}
          help={
            <p className="text-muted-foreground">
              {manage
                ? tr("notifications.intro.manage")
                : tr("notifications.intro.own")}
            </p>
          }
          toolbar={
            <div className="w-44">
              <Control
                input={grouping.input.group}
                label=""
                select
                icon={Layers}
                // On the trigger, where a select's name is read.
                inputProps={{
                  "aria-label": tr("notifications.group.by"),
                  "data-testid": "notifications-group-by",
                }}
                placeholder={tr("notifications.group.none")}
                items={[
                  {
                    value: "resource",
                    label: tr("notifications.group.resource"),
                  },
                  {
                    value: "recipient",
                    label: tr("notifications.group.recipient"),
                  },
                ]}
              />
            </div>
          }
          actions={[
            {
              icon: Plus,
              label: tr("notifications.add"),
              primary: true,
              disabled: busy || available.length === 0,
              onClick: () => setAdding(true),
            },
          ]}
          bulkActions={bulkActions}
          rowActions={rowActions}
          emptyState={{
            icon: BellRing,
            title: tr("notifications.nobody"),
            description: manage
              ? tr("notifications.intro.manage")
              : tr("notifications.intro.own"),
          }}
          noMatchState={{ title: tr("notifications.emptyFilter") }}
          columns={{
            event: {
              label: tr("notifications.table.event"),
              sortable: true,
              sortValue: (row) => row.eventLabel,
              cell: (row) => (
                <span
                  className="flex min-w-0 flex-wrap items-center gap-2"
                  data-testid={`notification-event-${row.event}`}
                >
                  <span className="font-medium">{row.eventLabel}</span>
                  {!row.available && (
                    <Badge variant="outline" title={row.reason}>
                      {tr("notifications.unavailable")}
                    </Badge>
                  )}
                </span>
              ),
            },
            recipient: {
              label: tr("notifications.table.recipient"),
              sortable: true,
              sortValue: (row) => row.recipientLabel,
              cell: (row) => (
                <span
                  className="flex min-w-0 items-center gap-2"
                  data-testid={`notification-row-${row.id}`}
                >
                  {recipientIcon(row)}
                  <span className="truncate">{row.recipientLabel}</span>
                </span>
              ),
            },
            // No header (#Q4193): the cell says what it narrows to, and a
            // header with no name has no sort button either.
            filter: {
              label: "",
              cell: (row) =>
                row.filterLabel ? (
                  <span className="truncate">{row.filterLabel}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {tr("notifications.form.filter.any")}
                  </span>
                ),
            },
            how: {
              label: tr("notifications.table.how"),
              cell: (row) => (
                <span className="flex flex-wrap gap-1">
                  {row.how.map((it) => (
                    <Badge key={it} variant="secondary">
                      {howLabel(it)}
                    </Badge>
                  ))}
                </span>
              ),
            },
            status: {
              label: tr("notifications.table.status"),
              sortable: true,
              cell: (row) =>
                row.status === "paused" ? (
                  <Badge variant="outline">
                    <BellOff className="size-3" />
                    {tr("notifications.status.paused")}
                  </Badge>
                ) : (
                  // A tag like Paused, not plain text (#Q4188).
                  <Badge variant="outline">
                    <BellRing className="size-3" />
                    {tr("notifications.status.active")}
                  </Badge>
                ),
            },
          }}
        />
      )}
      <NotificationAddDialog
        open={adding}
        onOpenChange={setAdding}
        projectId={projectId}
        catalog={catalogItems}
        targets={targets}
        me={`member:${me ?? ""}`}
        manage={manage}
        filters={filters.data ?? {}}
        invalidates={key}
      />
    </div>
  );
};

export default ProjectSettingsNotificationsPage;
