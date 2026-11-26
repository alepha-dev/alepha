import { Button, Checkbox, DialogFooter, Label } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { I18n } from "../../services/I18n.ts";

/**
 * Whose events a bell with authors tells of (#Q4290): every one, all but the
 * viewer's own, or all but the project members'.
 */
export type SubscriptionBellFrom = "all" | "notMine" | "notMembers";

export interface SubscriptionBellPick {
  /**
   * `inapp`, `email`, and `channel:<id>` for a project channel.
   */
  channels: string[];
  events: string[];
  from: SubscriptionBellFrom;
}

export interface SubscriptionBellFormProps {
  initial: SubscriptionBellPick;
  /**
   * What Channels offers: In-app and Email, then the project's channels for
   * a member who manages notifications.
   */
  channels: Array<{ value: string; label: string }>;
  /**
   * Every event of the bell, with its title: a choice only past one.
   */
  events: Array<{ value: string; label: string }>;
  authors?: SubscriptionBellAuthors;
  /**
   * Whether the viewer is notified already: the confirm button says Save.
   */
  on: boolean;
  busy: boolean;
  /**
   * Saves the pick; with no channel, it turns the bell off (#Q4452).
   */
  onSave: (pick: SubscriptionBellPick) => void;
  onCancel: () => void;
}

export interface SubscriptionBellAuthors {
  allLabel: string;
  notMineLabel: string;
  notMembersLabel: string;
}

/**
 * The body of a bell's dialog (#Q4290): Channels, a multi select, and for a
 * bell with authors, From whom, a single select; the events as checkboxes
 * when the bell has several. Mounted each time the dialog opens, so it
 * starts from what the viewer's rows say. No Stop button (#Q4452): Channels
 * may be left empty, and Save then turns the bell off.
 */
const SubscriptionBellForm = (props: SubscriptionBellFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [events, setEvents] = useState(props.initial.events);
  const form = useForm({
    schema: z.object({
      // Optional: empty is how a bell is turned off (#Q4452).
      channels: z.array(z.text()).optional(),
      from: z.enum(["all", "notMine", "notMembers"]),
    }),
    initialValues: {
      channels: props.initial.channels,
      from: props.initial.from,
    },
    handler: async () => {},
  });
  const values = useFormValues(form);
  const channels = values.channels ?? [];

  return (
    <>
      <div data-testid="subscription-bell-channels">
        <Control
          input={form.input.channels}
          label={tr("notifications.bell.channel")}
          items={props.channels}
          clearLabel={tr("notifications.bell.none")}
        />
      </div>
      {props.events.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span id="subscription-bell-events" className="text-sm font-medium">
            {tr("notifications.bell.events")}
          </span>
          <div
            role="group"
            aria-labelledby="subscription-bell-events"
            className="flex flex-col gap-2"
          >
            {props.events.map((event) => (
              <Label key={event.value} className="flex items-center gap-2">
                <Checkbox
                  checked={events.includes(event.value)}
                  onCheckedChange={(checked) =>
                    setEvents((current) =>
                      props.events
                        .map((it) => it.value)
                        .filter((it) =>
                          it === event.value ? checked : current.includes(it),
                        ),
                    )
                  }
                />
                {event.label}
              </Label>
            ))}
          </div>
        </div>
      )}
      {props.authors && (
        <div data-testid="subscription-bell-from">
          <Control
            input={form.input.from}
            label={tr("notifications.bell.authors")}
            items={[
              { value: "all", label: props.authors.allLabel },
              { value: "notMine", label: props.authors.notMineLabel },
              { value: "notMembers", label: props.authors.notMembersLabel },
            ]}
          />
        </div>
      )}
      <DialogFooter>
        <Button variant="outlined" onClick={props.onCancel}>
          {tr("notifications.form.cancel")}
        </Button>
        <Button
          onClick={() =>
            props.onSave({
              channels,
              events,
              from: (values.from ?? "all") as SubscriptionBellFrom,
            })
          }
          // With channels, an event at least; with none, Save turns it off,
          // which an off bell has nothing to do.
          disabled={
            props.busy ||
            (channels.length > 0 && events.length === 0) ||
            (!props.on && channels.length === 0)
          }
          data-testid="subscription-bell-confirm"
        >
          {props.on
            ? tr("notifications.form.save")
            : tr("notifications.bell.confirm")}
        </Button>
      </DialogFooter>
    </>
  );
};

export default SubscriptionBellForm;
