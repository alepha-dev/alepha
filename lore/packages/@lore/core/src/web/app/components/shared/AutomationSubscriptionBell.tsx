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
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bell, BellRing } from "lucide-react";
import { useState } from "react";

import type { AutomationController } from "../../../../api/controllers/AutomationController.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { hasCapability } from "../../services/projectCapabilities.ts";
import { canInProject } from "../../services/projectRank.ts";

/** The channels a subscription notifies on, as the stock presets name them. */
type Channel = "inbox" | "email";

const CHANNELS: Channel[] = ["inbox", "email"];

export interface AutomationSubscriptionBellProps {
  /** The stock preset the subscription is made from, `feedback-created`. */
  presetKey: string;
  /** What the bell subscribes to, as its tooltip: "Notify me of new feedback". */
  label: string;
  /** The dialog's sentence on what turning it on does. */
  description: string;
  /** The confirmation's sentence on what turning it off stops. */
  offDescription: string;
  testId?: string;
}

/**
 * A bell that subscribes its viewer to a stock preset in the current
 * project, through a rule of their own (#Q3576). On is a dialog naming what
 * will happen and offering a channel, then a rule created enabled with the
 * viewer as recipient; off is a confirmation, then the rule is deleted.
 *
 * Its state is the server's: lit when the viewer owns an enabled rule the
 * bell made (`AutomationSubscriptionService`), so it holds across a reload
 * and across devices, and goes dark when that rule is disabled or deleted
 * from the automations pages.
 *
 * Drawn only where the viewer could create the rule: the project has Work
 * and their rank writes automations. Elsewhere it is
 * nothing, not a disabled bell.
 *
 * A new surface adopts it with its preset key and three sentences; the
 * folio #F1501, "Subscriptions: a bell over an automation", holds the pattern.
 */
export const AutomationSubscriptionBell = (
  props: AutomationSubscriptionBellProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const [open, setOpen] = useState(false);
  // Several at once (#Q3602): one marked rule per channel, at least one.
  const [channels, setChannels] = useState<Channel[]>(["inbox"]);
  const available =
    !!project &&
    hasCapability(project, "work") &&
    canInProject(project, "automation:read") &&
    canInProject(project, "automation:write");
  const projectId = project?.id ?? 0;
  const key = ["automation-subscription", projectId, props.presetKey];
  const state = useQuery(
    {
      key,
      enabled: available,
      handler: ({ signal }) =>
        api.getAutomationSubscription(
          { params: { projectId, key: props.presetKey } },
          { request: { signal } },
        ),
    },
    [available, projectId, props.presetKey],
  );
  const set = useAction<[subscribed: boolean], void>(
    {
      handler: async (_ctx, subscribed) => {
        await api.setAutomationSubscription({
          params: { projectId, key: props.presetKey },
          body: subscribed ? { subscribed, channels } : { subscribed },
        });
        setOpen(false);
        queries.invalidate(key);
        queries.invalidate(["automations", projectId]);
      },
    },
    [api, projectId, props.presetKey, channels, queries],
  );
  if (!available) return null;

  const subscribed = state.data?.subscribed === true;
  const label = subscribed ? tr("automation.subscription.on") : props.label;
  // The dialog opens either way: on a live subscription it shows the
  // channels it has, to change them or to turn it off (#Q3602).
  const toggle = () => {
    const live = (state.data?.channels ?? []).filter(
      (it): it is Channel => it === "inbox" || it === "email",
    );
    setChannels(subscribed && live.length ? live : ["inbox"]);
    setOpen(true);
  };
  const unsubscribe = async () => {
    if (
      await dialog.confirm({
        title: tr("automation.subscription.offTitle"),
        description: props.offDescription,
        confirmLabel: tr("automation.subscription.offConfirm"),
        destructive: true,
      })
    )
      await set.run(false);
  };
  const pick = (value: Channel, checked: boolean) =>
    setChannels((current) =>
      CHANNELS.filter((it) =>
        it === value ? checked : current.includes(it),
      ),
    );

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="minimal"
              size="icon"
              aria-label={label}
              aria-pressed={subscribed}
              disabled={!state.data || set.loading}
              data-testid={props.testId}
              data-subscribed={subscribed || undefined}
              onClick={() => void toggle()}
            />
          }
        >
          {subscribed ? (
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
              id="automation-subscription-channel"
              className="text-sm font-medium"
            >
              {tr("automation.subscription.channel")}
            </span>
            <div
              role="group"
              aria-labelledby="automation-subscription-channel"
              className="flex flex-wrap gap-4"
            >
              {CHANNELS.map((value) => (
                <Label key={value} className="flex items-center gap-2">
                  <Checkbox
                    checked={channels.includes(value)}
                    onCheckedChange={(checked) => pick(value, checked)}
                  />
                  {tr(`automation.subscription.channel.${value}`)}
                </Label>
              ))}
            </div>
            <p className="text-muted-foreground text-sm">
              {tr("automation.subscription.rule")}
            </p>
          </div>
          <DialogFooter>
            {subscribed ? (
              <Button
                variant="outlined"
                intent="danger"
                disabled={set.loading}
                onClick={() => void unsubscribe()}
              >
                {tr("automation.subscription.offConfirm")}
              </Button>
            ) : (
              <Button variant="outlined" onClick={() => setOpen(false)}>
                {tr("automation.subscription.cancel")}
              </Button>
            )}
            <Button
              onClick={() => void set.run(true)}
              disabled={set.loading || channels.length === 0}
              data-testid="automation-subscription-confirm"
            >
              {subscribed
                ? tr("automation.subscription.save")
                : tr("automation.subscription.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
