import { Badge, Button, useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { BellOff, BellRing, Plus } from "lucide-react";
import { useState } from "react";

import type { ProjectChannelController } from "../../../../../../api/controllers/ProjectChannelController.ts";
import type { ProjectEventController } from "../../../../../../api/controllers/ProjectEventController.ts";
import type { SubscriptionController } from "../../../../../../api/controllers/SubscriptionController.ts";
import { notificationFormSchema } from "../../../../../../api/schemas/notificationFormSchema.ts";
import type { ProjectEventCatalogEntry } from "../../../../../../api/schemas/projectEventCatalogEntrySchema.ts";
import type { SubscriptionResource } from "../../../../../../api/schemas/subscriptionResourceSchema.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { canInProject } from "../../../../services/projectRank.ts";
import { useProjectUsers } from "../../../shared/useProjectUsers.ts";
import { NotificationLabels } from "./NotificationLabels.ts";

/**
 * Settings > Notifications (#Q3892): every event the project can emit,
 * grouped by resource, with who is notified of it and on which channel.
 *
 * Adding one is three pickers and no text: the event, who is notified (a
 * member, or one of the project's channels) and, for an event that takes
 * one, a filter picked from the project's own hosts, apps or monitors.
 * Whoever holds `subscription:manage` notifies any member ("tell her, not
 * me, when the app is down"); anyone else sees and edits their own rows.
 * An event the project's capabilities do not give is listed, unavailable,
 * with the reason.
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
  const labels = NotificationLabels;

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
  const rows = useQuery(
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

  const save = useAction<
    [
      values: {
        event: string;
        target?: string;
        filter?: string;
        inapp?: boolean;
        email?: boolean;
      },
    ],
    void
  >(
    {
      handler: async (_ctx, values) => {
        const target = values.target ?? "";
        const channelId = target.startsWith("channel:")
          ? target.slice("channel:".length)
          : undefined;
        const memberId = target.startsWith("member:")
          ? target.slice("member:".length)
          : undefined;
        await subscriptions.setSubscription({
          params: { projectId },
          body: {
            event: values.event,
            ...(values.filter ? { filter: values.filter } : {}),
            ...(channelId ? { channelId } : {}),
            ...(memberId ? { memberId } : {}),
            ...(channelId
              ? {}
              : {
                  channels: [
                    ...(values.inapp !== false ? (["inapp"] as const) : []),
                    ...(values.email ? (["email"] as const) : []),
                  ],
                }),
          },
        });
        setAdding(false);
      },
      invalidates: [key],
    },
    [subscriptions, projectId],
  );
  const mute = useAction<[row: SubscriptionResource], void>(
    {
      handler: async (_ctx, row) => {
        await subscriptions.muteSubscription({
          params: { projectId, id: row.id },
          body: { muted: !row.mutedAt },
        });
      },
      invalidates: [key],
    },
    [subscriptions, projectId],
  );
  const remove = useAction<[row: SubscriptionResource], void>(
    {
      handler: async (_ctx, row) => {
        if (
          !(await dialog.confirm({
            title: tr("notifications.remove.title"),
            description: tr("notifications.remove.description"),
            confirmLabel: tr("notifications.remove.confirm"),
            destructive: true,
          }))
        )
          return;
        await subscriptions.deleteSubscription({
          params: { projectId, id: row.id },
        });
      },
      invalidates: [key],
    },
    [subscriptions, projectId],
  );

  const available = (catalog.data?.items ?? []).filter((it) => it.available);
  const form = useForm(
    {
      schema: notificationFormSchema,
      initialValues: {
        event: available[0]?.name ?? "",
        target: `member:${auth.user?.id ?? ""}`,
        inapp: true,
        email: false,
      },
      handler: async (values) => {
        await save.run(values);
      },
    },
    [adding, available[0]?.name],
  );
  const values = useFormValues(form);
  if (!project) return null;

  const me = auth.user?.id;
  const selected = available.find((it) => it.name === values.event);
  const busy = save.loading || mute.loading || remove.loading;
  const nameOf = (id: string) => {
    const user = users.find((it) => it.id === id);
    if (!user) return tr("notifications.someone");
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    return name || user.username || user.email || tr("notifications.someone");
  };
  const channelName = (id: string) =>
    channels.data?.items.find((it) => it.id === id)?.name ?? id;
  const filterLabel = (event: ProjectEventCatalogEntry, value: string) =>
    filters.data?.[event.filter?.resource ?? ""]?.find(
      (it) => it.value === value,
    )?.label ?? value;
  const targets = [
    ...(manage
      ? users.map((user) => ({
          value: `member:${user.id}`,
          label:
            user.id === me ? tr("notifications.target.me") : nameOf(user.id),
        }))
      : [
          { value: `member:${me ?? ""}`, label: tr("notifications.target.me") },
        ]),
    ...(manage
      ? (channels.data?.items ?? [])
          .filter((it) => !it.builtIn)
          .map((it) => ({ value: `channel:${it.id}`, label: it.name }))
      : []),
  ];
  const toChannel = String(values.target ?? "").startsWith("channel:");

  return (
    <div className="flex flex-col gap-4" data-testid="notifications-settings">
      <p className="text-muted-foreground text-sm">
        {manage
          ? tr("notifications.intro.manage")
          : tr("notifications.intro.own")}
      </p>
      {!adding && (
        <div>
          <Button
            onClick={() => setAdding(true)}
            disabled={busy || available.length === 0}
            data-testid="notification-add"
          >
            <Plus className="size-4" />
            {tr("notifications.add")}
          </Button>
        </div>
      )}
      {adding && (
        <form
          {...form.props}
          className="bg-card flex flex-col gap-3 rounded-lg border p-4"
          data-testid="notification-form"
        >
          <Control
            input={form.input.event}
            label={tr("notifications.form.event")}
            select
            items={available.map((it) => ({
              value: it.name,
              label: labels.event(tr, it),
            }))}
            disabled={busy}
          />
          <Control
            input={form.input.target}
            label={tr("notifications.form.target")}
            select
            items={targets}
            disabled={busy || !manage}
          />
          {selected?.filter && (
            <Control
              input={form.input.filter}
              label={tr(
                `notifications.form.filter.${selected.filter.resource}`,
              )}
              select
              items={[
                { value: "", label: tr("notifications.form.filter.any") },
                ...(filters.data?.[selected.filter.resource] ?? []),
              ]}
              disabled={busy}
            />
          )}
          {!toChannel && (
            <div className="flex flex-wrap gap-4">
              <Control
                input={form.input.inapp}
                label={tr("notifications.channel.inapp")}
                disabled={busy}
              />
              <Control
                input={form.input.email}
                label={tr("notifications.channel.email")}
                disabled={busy}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {tr("notifications.form.save")}
            </Button>
            <Button
              type="button"
              variant="outlined"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              {tr("notifications.form.cancel")}
            </Button>
          </div>
        </form>
      )}
      {labels.groups(catalog.data?.items ?? []).map(([resource, items]) => (
        <section
          key={resource}
          className="bg-card rounded-lg border"
          data-testid={`notifications-${resource}`}
        >
          <h2 className="border-b px-4 py-2 font-medium">
            {tr(`notifications.resource.${resource}`, { default: resource })}
          </h2>
          <ul className="divide-y">
            {items.map((event) => {
              const own = (rows.data?.items ?? []).filter(
                (it) => it.event === event.name,
              );
              return (
                <li
                  key={event.name}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start"
                  data-testid={`notification-event-${event.name}`}
                >
                  <div className="min-w-0 sm:w-1/3">
                    <div className="font-medium">{labels.event(tr, event)}</div>
                    {!event.available && (
                      <div className="text-muted-foreground text-sm">
                        <Badge variant="outline" className="me-2">
                          {tr("notifications.unavailable")}
                        </Badge>
                        {labels.reason(tr, event)}
                      </div>
                    )}
                  </div>
                  <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
                    {own.length === 0 && (
                      <li className="text-muted-foreground text-sm">
                        {tr("notifications.nobody")}
                      </li>
                    )}
                    {own.map((row) => (
                      <li
                        key={row.id}
                        className="flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-sm"
                        data-testid={`notification-row-${row.id}`}
                      >
                        {row.mutedAt ? (
                          <BellOff className="text-muted-foreground size-3.5" />
                        ) : (
                          <BellRing className="size-3.5" />
                        )}
                        <span className="truncate">
                          {row.channelId
                            ? channelName(row.channelId)
                            : row.memberId === me
                              ? tr("notifications.target.me")
                              : nameOf(row.memberId ?? "")}
                          {row.filter
                            ? ` · ${filterLabel(event, row.filter)}`
                            : ""}
                          {row.channels.length
                            ? ` · ${row.channels
                                .map((it) => tr(`notifications.channel.${it}`))
                                .join(", ")}`
                            : ""}
                        </span>
                        {row.memberId === me && (
                          <Button
                            size="sm"
                            variant="minimal"
                            disabled={busy}
                            onClick={() => void mute.run(row)}
                          >
                            {row.mutedAt
                              ? tr("notifications.unmute")
                              : tr("notifications.mute")}
                          </Button>
                        )}
                        {(manage || row.memberId === me) && (
                          <Button
                            size="sm"
                            variant="minimal"
                            intent="danger"
                            disabled={busy}
                            onClick={() => void remove.run(row)}
                          >
                            {tr("notifications.remove.confirm")}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default ProjectSettingsNotificationsPage;
