import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control, type SelectOption } from "@alepha/ui/form";
import { useAction, useClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { SubscriptionController } from "../../../../../../api/controllers/SubscriptionController.ts";
import { notificationFormSchema } from "../../../../../../api/schemas/notificationFormSchema.ts";
import type { ProjectEventCatalogEntry } from "../../../../../../api/schemas/projectEventCatalogEntrySchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { NotificationLabels } from "./NotificationLabels.ts";

export interface NotificationAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /**
   * Every event of the catalog: an unavailable one is listed, disabled, with
   * the switch that turns it on.
   */
  catalog: ProjectEventCatalogEntry[];
  /**
   * Who may be notified: `member:<id>` or `channel:<id>`, as the Who filter
   * names them.
   */
  targets: SelectOption[];
  /**
   * The first target, the reader themself.
   */
  me: string;
  /**
   * Whether the reader may pick another target than themself.
   */
  manage: boolean;
  /**
   * The options of each filter resource (`host`, `app`, `monitor`).
   */
  filters: Record<string, Array<{ value: string; label: string }>>;
  /**
   * The read the table draws from, refreshed once the row is saved.
   */
  invalidates: unknown[];
}

/**
 * Notify someone (#Q3892, in a dialog since #Q3912): the event, who is
 * notified (a member, or one of the project's channels) and, for an event
 * that takes one, a filter picked from the project's own hosts, apps or
 * monitors. Pickers only, no text.
 */
const NotificationAddDialog = (props: NotificationAddDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const subscriptions = useClient<SubscriptionController>();
  const available = props.catalog.filter((it) => it.available);

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
          params: { projectId: props.projectId },
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
        props.onOpenChange(false);
      },
      invalidates: [props.invalidates],
    },
    [subscriptions, props.projectId, props.onOpenChange],
  );

  // Rebuilt each time the dialog opens: `useForm` anchors its values at
  // mount, and the last notification's choices are not the next one's.
  const form = useForm(
    {
      schema: notificationFormSchema,
      initialValues: {
        event: available[0]?.name ?? "",
        target: props.me,
        inapp: true,
        email: false,
      },
      handler: async (values) => {
        await save.run(values);
      },
    },
    [props.open, available[0]?.name],
  );
  const values = useFormValues(form);
  const selected = available.find((it) => it.name === values.event);
  const toChannel = String(values.target ?? "").startsWith("channel:");
  const busy = save.loading;

  const events: SelectOption[] = NotificationLabels.groups(
    props.catalog,
  ).flatMap(([resource, items]) =>
    items.map((it) => ({
      value: it.name,
      label: NotificationLabels.event(tr, it),
      description: it.available
        ? tr(`notifications.resource.${resource}`, { default: resource })
        : NotificationLabels.reason(tr, it),
      ...(it.available
        ? {}
        : { tag: tr("notifications.unavailable"), disabled: true }),
    })),
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("notifications.add")}</DialogTitle>
          <DialogDescription>
            {props.manage
              ? tr("notifications.intro.manage")
              : tr("notifications.intro.own")}
          </DialogDescription>
        </DialogHeader>
        <form
          {...form.props}
          className="flex flex-col gap-3"
          data-testid="notification-form"
        >
          <Control
            input={form.input.event}
            label={tr("notifications.form.event")}
            select
            items={events}
            disabled={busy}
          />
          <Control
            input={form.input.target}
            label={tr("notifications.form.target")}
            select
            items={props.targets}
            disabled={busy || !props.manage}
          />
          {selected?.filter && (
            <Control
              input={form.input.filter}
              label={tr(
                `notifications.form.filter.${selected.filter.resource}`,
              )}
              select
              items={[
                {
                  value: "",
                  label: NotificationLabels.anyFilter(
                    tr,
                    selected.filter.resource,
                  ),
                },
                ...(props.filters[selected.filter.resource] ?? []),
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
          <DialogFooter>
            <Button
              type="button"
              variant="minimal"
              disabled={busy}
              onClick={() => props.onOpenChange(false)}
            >
              {tr("notifications.form.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={busy || !selected}
              data-testid="notification-save"
            >
              {tr("notifications.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NotificationAddDialog;
