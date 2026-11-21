import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDialog,
} from "@alepha/ui";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Bell, BellRing } from "lucide-react";
import { useState } from "react";

import type { ProjectEventController } from "../../../../api/controllers/ProjectEventController.ts";
import type { SubscriptionController } from "../../../../api/controllers/SubscriptionController.ts";
import type { SubscriptionChannel } from "../../../../api/schemas/subscriptionChannelSchema.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { NotificationLabels } from "../project/settings/notifications/NotificationLabels.ts";

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
  /** The confirmation's sentence on what turning it off stops. */
  offDescription: string;
  /**
   * Who caused the event, as two choices in the dialog (#Q4055): the
   * feedback bell's "feedback I submit" and "feedback from project
   * members". Given, the bell opens its dialog on the first click too,
   * since the choice is the point; off, an event is told whoever caused it.
   */
  authors?: { mineLabel: string; membersLabel: string };
  testId?: string;
}

const CHANNELS: SubscriptionChannel[] = ["inapp", "email"];

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
  const dialog = useDialog();
  const auth = useAuth();
  const [project] = useStore(currentProjectAtom);
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<SubscriptionChannel[]>(["inapp"]);
  const [events, setEvents] = useState<string[]>(props.events);
  const [includeMine, setIncludeMine] = useState(true);
  const [includeMembers, setIncludeMembers] = useState(true);
  const projectId = project?.id ?? 0;
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

  const save = useAction<
    [
      on: boolean,
      picked?: {
        channels: SubscriptionChannel[];
        events: string[];
        notMine?: boolean;
        notMembers?: boolean;
      },
    ],
    void
  >(
    {
      handler: async (_ctx, on, picked) => {
        const wanted = picked ?? {
          channels,
          events,
          notMine: props.authors ? !includeMine : undefined,
          notMembers: props.authors ? !includeMembers : undefined,
        };
        for (const event of props.events) {
          const row = mine.find((it) => it.event === event);
          if (on && wanted.events.includes(event))
            await api.setSubscription({
              params: { projectId },
              body: {
                event,
                ...(props.filter ? { filter: props.filter } : {}),
                channels: wanted.channels,
                ...(wanted.notMine ? { notMine: true } : {}),
                ...(wanted.notMembers ? { notMembers: true } : {}),
              },
            });
          else if (row)
            await api.deleteSubscription({
              params: { projectId, id: row.id },
            });
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
      props.authors,
      channels,
      events,
      includeMine,
      includeMembers,
      mine,
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
      void save.run(true, { channels: ["inapp"], events: [...props.events] });
      return;
    }
    const current = live[0]?.channels ?? [];
    setChannels(current.length ? current : ["inapp"]);
    setEvents(live.length ? live.map((row) => row.event) : [...props.events]);
    setIncludeMine(!live[0]?.notMine);
    setIncludeMembers(!live[0]?.notMembers);
    setOpen(true);
  };
  const off = async () => {
    if (
      await dialog.confirm({
        title: tr("notifications.bell.offTitle"),
        description: props.offDescription,
        confirmLabel: tr("notifications.bell.offConfirm"),
        destructive: true,
      })
    )
      await save.run(false);
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
          <div className="flex flex-col gap-1.5">
            <span
              id="subscription-bell-channel"
              className="text-sm font-medium"
            >
              {tr("notifications.bell.channel")}
            </span>
            <div
              role="group"
              aria-labelledby="subscription-bell-channel"
              className="flex flex-wrap gap-4"
            >
              {CHANNELS.map((value) => (
                <Label key={value} className="flex items-center gap-2">
                  <Checkbox
                    checked={channels.includes(value)}
                    onCheckedChange={(checked) =>
                      setChannels((current) =>
                        CHANNELS.filter((it) =>
                          it === value ? checked : current.includes(it),
                        ),
                      )
                    }
                  />
                  {tr(`notifications.channel.${value}`)}
                </Label>
              ))}
            </div>
          </div>
          {props.events.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span
                id="subscription-bell-events"
                className="text-sm font-medium"
              >
                {tr("notifications.bell.events")}
              </span>
              <div
                role="group"
                aria-labelledby="subscription-bell-events"
                className="flex flex-col gap-2"
              >
                {props.events.map((event) => (
                  <Label key={event} className="flex items-center gap-2">
                    <Checkbox
                      checked={events.includes(event)}
                      onCheckedChange={(checked) =>
                        setEvents((current) =>
                          props.events.filter((it) =>
                            it === event ? checked : current.includes(it),
                          ),
                        )
                      }
                    />
                    {title(event)}
                  </Label>
                ))}
              </div>
            </div>
          )}
          {props.authors && (
            <div className="flex flex-col gap-1.5">
              <span
                id="subscription-bell-authors"
                className="text-sm font-medium"
              >
                {tr("notifications.bell.authors")}
              </span>
              <div
                role="group"
                aria-labelledby="subscription-bell-authors"
                className="flex flex-col gap-2"
              >
                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={includeMine}
                    onCheckedChange={(checked) => setIncludeMine(checked)}
                    data-testid="subscription-bell-mine"
                  />
                  {props.authors.mineLabel}
                </Label>
                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={includeMembers}
                    onCheckedChange={(checked) => setIncludeMembers(checked)}
                    data-testid="subscription-bell-members"
                  />
                  {props.authors.membersLabel}
                </Label>
              </div>
            </div>
          )}
          <DialogFooter>
            {subscribed || partial ? (
              <Button
                variant="outlined"
                intent="danger"
                disabled={save.loading}
                onClick={() => void off()}
              >
                {tr("notifications.bell.offConfirm")}
              </Button>
            ) : (
              <Button variant="outlined" onClick={() => setOpen(false)}>
                {tr("notifications.form.cancel")}
              </Button>
            )}
            <Button
              onClick={() => void save.run(true)}
              disabled={
                save.loading || channels.length === 0 || events.length === 0
              }
              data-testid="subscription-bell-confirm"
            >
              {subscribed || partial
                ? tr("notifications.form.save")
                : tr("notifications.bell.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
