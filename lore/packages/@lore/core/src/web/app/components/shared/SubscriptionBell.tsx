import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Bell, BellRing } from "lucide-react";
import { useState } from "react";

import type { ProjectChannelController } from "../../../../api/controllers/ProjectChannelController.ts";
import type { ProjectEventController } from "../../../../api/controllers/ProjectEventController.ts";
import type { SubscriptionController } from "../../../../api/controllers/SubscriptionController.ts";
import type { SubscriptionChannel } from "../../../../api/schemas/subscriptionChannelSchema.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { NotificationLabels } from "../project/settings/notifications/NotificationLabels.ts";
import SubscriptionBellForm, {
  type SubscriptionBellAuthors,
  type SubscriptionBellPick,
} from "./SubscriptionBellForm.tsx";
import { useRank } from "./useRank.ts";

export interface SubscriptionBellProps {
  /**
   * The events one bell covers, such as `["feedback.created"]`, or a
   * monitor's down and up together.
   */
  events: string[];
  /**
   * The resource the page shows, as the events' filter value (a host's or a
   * monitor's id). Absent, the bell covers the whole project.
   */
  filter?: string;
  /** What the bell does, as its tooltip: "Notify me of new feedback". */
  label: string;
  /** The dialog's sentence on what turning it on does. */
  description: string;
  /**
   * Who caused the event, as a From whom select in the dialog (#Q4055,
   * #Q4290): All, All except from me, All except from project members.
   * Given, the bell opens its dialog on the first click too, since the
   * choice is the point; off, an event is told whoever caused it.
   */
  authors?: SubscriptionBellAuthors;
  testId?: string;
}

const CHANNELS: SubscriptionChannel[] = ["inapp", "email"];

/**
 * A project channel in the Channels select: `channel:<id>`.
 */
const CHANNEL_PREFIX = "channel:";

/**
 * A bell that notifies its viewer of a page's events (#Q3892): one
 * subscription row per event, the viewer's own, scoped to the resource the
 * page shows. It creates no automation (#F1501 is superseded).
 *
 * One click turns it on, in the app, for every event of the bell. Lit when
 * every event has an unmuted row of the viewer's, "partly on" when some do;
 * then a click opens its dialog, which picks the channels and, for a bell
 * over several events, which ones, or stops it. A double click writes one
 * row per event: the server's key is unique.
 */
export const SubscriptionBell = (props: SubscriptionBellProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<SubscriptionController>();
  const catalogApi = useClient<ProjectEventController>();
  const auth = useAuth();
  const [project] = useStore(currentProjectAtom);
  const channelApi = useClient<ProjectChannelController>();
  const { can } = useRank();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<SubscriptionBellPick>({
    channels: ["inapp"],
    events: props.events,
    from: "all",
  });
  const projectId = project?.id ?? 0;
  // A member who manages the project's notifications may route the bell to
  // its channels too (#Q4290); the server refuses anyone else, this only
  // hides what it would refuse.
  const manage = can("subscription:manage");
  const me = auth.user?.id;
  const key = ["subscriptions", projectId];
  const rows = useQuery(
    {
      key,
      enabled: !!project && !!me,
      handler: ({ signal }) =>
        api.listSubscriptions(
          { params: { projectId } },
          { request: { signal } },
        ),
    },
    [projectId, me],
  );
  const catalog = useQuery(
    {
      key: ["event-catalog", projectId],
      enabled: !!project && props.events.length > 1,
      handler: ({ signal }) =>
        catalogApi.getProjectEventCatalog(
          { params: { projectId } },
          { request: { signal } },
        ),
      onError: () => {},
    },
    [projectId],
  );
  const projectChannels = useQuery(
    {
      key: ["project-channels", projectId],
      enabled: !!project && manage && open,
      handler: ({ signal }) =>
        channelApi.listProjectChannels(
          { params: { projectId } },
          { request: { signal } },
        ),
      onError: () => {},
    },
    [projectId, manage, open],
  );
  const routable = (projectChannels.data?.items ?? []).filter(
    (it) => !it.builtIn,
  );
  // The project channels' rows for this bell's events and resource.
  const channelRows = (rows.data?.items ?? []).filter(
    (row) =>
      !!row.channelId &&
      props.events.includes(row.event) &&
      (row.filter ?? "") === (props.filter ?? ""),
  );
  const mine = (rows.data?.items ?? []).filter(
    (row) =>
      row.memberId === me &&
      props.events.includes(row.event) &&
      (row.filter ?? "") === (props.filter ?? ""),
  );
  const live = mine.filter((row) => !row.mutedAt);
  const subscribed = props.events.every((event) =>
    live.some((row) => row.event === event),
  );
  const partial = !subscribed && live.length > 0;

  const save = useAction<[on: boolean, picked?: SubscriptionBellPick], void>(
    {
      handler: async (_ctx, on, picked) => {
        const wanted = picked ?? {
          channels: ["inapp"],
          events: [...props.events],
          from: "all" as const,
        };
        const personal = CHANNELS.filter((it) => wanted.channels.includes(it));
        const filter = props.filter ? { filter: props.filter } : {};
        for (const event of props.events) {
          const keep = on && wanted.events.includes(event);
          const row = mine.find((it) => it.event === event);
          if (keep && personal.length > 0)
            await api.setSubscription({
              params: { projectId },
              body: {
                event,
                ...filter,
                channels: personal,
                ...(wanted.from === "notMine" ? { notMine: true } : {}),
                ...(wanted.from === "notMembers" ? { notMembers: true } : {}),
              },
            });
          else if (row)
            await api.deleteSubscription({
              params: { projectId, id: row.id },
            });
          // One row per project channel picked; a channel is no member, so
          // it never takes `notMine`, which the server refuses.
          if (!manage) continue;
          for (const channel of routable) {
            const picked = wanted.channels.includes(
              `${CHANNEL_PREFIX}${channel.id}`,
            );
            const held = channelRows.find(
              (it) => it.event === event && it.channelId === channel.id,
            );
            if (keep && picked)
              await api.setSubscription({
                params: { projectId },
                body: {
                  event,
                  ...filter,
                  channelId: channel.id,
                  ...(wanted.from === "notMembers" ? { notMembers: true } : {}),
                },
              });
            else if (held)
              await api.deleteSubscription({
                params: { projectId, id: held.id },
              });
          }
        }
        setOpen(false);
      },
      invalidates: [key],
    },
    [
      api,
      projectId,
      props.events,
      props.filter,
      mine,
      channelRows,
      routable,
      manage,
    ],
  );
  if (!project || !me) return null;

  const label = subscribed
    ? tr("notifications.bell.on")
    : partial
      ? tr("notifications.bell.partial")
      : props.label;
  // Off, one click turns it on, in the app, for every event of the bell;
  // on, the click opens the dialog that changes or stops it.
  const toggle = () => {
    // With author choices the first click opens the dialog too (#Q4055).
    if (!subscribed && !partial && !props.authors) {
      void save.run(true, {
        channels: ["inapp"],
        events: [...props.events],
        from: "all",
      });
      return;
    }
    const current = live[0]?.channels ?? [];
    const routed = manage
      ? [
          ...new Set(
            channelRows.map((row) => `${CHANNEL_PREFIX}${row.channelId}`),
          ),
        ]
      : [];
    setInitial({
      channels: [
        ...(current.length || routed.length ? current : ["inapp"]),
        ...routed,
      ],
      events: live.length ? live.map((row) => row.event) : [...props.events],
      from: live[0]?.notMine
        ? "notMine"
        : live[0]?.notMembers
          ? "notMembers"
          : "all",
    });
    setOpen(true);
  };
  const title = (event: string) => {
    const entry = catalog.data?.items.find((it) => it.name === event);
    return NotificationLabels.event(tr, {
      name: event,
      label: entry?.label ?? event,
    });
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="minimal"
              size="icon"
              aria-label={label}
              aria-pressed={subscribed || partial}
              disabled={!rows.data || save.loading}
              data-testid={props.testId}
              data-subscribed={subscribed || undefined}
              data-partial={partial || undefined}
              onClick={() => toggle()}
            />
          }
        >
          {subscribed || partial ? (
            <BellRing className="text-primary size-4" />
          ) : (
            <Bell className="size-4" />
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.label}</DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          {open && (
            <SubscriptionBellForm
              // Remounted once the project's channels arrive, so the select
              // offers them and reads their rows back as picked.
              key={routable.map((it) => it.id).join(",")}
              initial={initial}
              channels={[
                ...CHANNELS.map((value) => ({
                  value,
                  label: tr(`notifications.channel.${value}`),
                })),
                ...(manage
                  ? routable.map((channel) => ({
                      value: `${CHANNEL_PREFIX}${channel.id}`,
                      label: channel.name,
                    }))
                  : []),
              ]}
              events={props.events.map((event) => ({
                value: event,
                label: title(event),
              }))}
              {...(props.authors ? { authors: props.authors } : {})}
              on={subscribed || partial}
              busy={save.loading}
              // No channel picked turns it off (#Q4452).
              onSave={(pick) => void save.run(pick.channels.length > 0, pick)}
              onCancel={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
