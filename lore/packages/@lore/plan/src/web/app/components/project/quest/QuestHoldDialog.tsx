import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@alepha/ui";
import { ControlDate } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { PauseCircle } from "lucide-react";
import { type HTMLAttributes, useState } from "react";

export interface QuestHoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  /**
   * The reason, and the hold's end as an ISO datetime when a day was picked:
   * the start of that day, in the reader's time zone.
   */
  onConfirm: (reason: string, until: string | undefined) => void;
}

/**
 * Put on hold (#Q4408): the reason, which is posted to the discussion, and
 * an optional day the hold lifts on its own, with quick picks for one day,
 * one, two and three weeks and one calendar month, labelled 1D 1W 2W 3W 1M
 * with the long form as their accessible name (#Q4447). Without a day the
 * hold waits for somebody to lift it.
 *
 * The day is the kit's `ControlDate` (#Q4446), never the browser's native
 * `<input type="date">`, which drew an OS calendar that ignored the theme.
 * The control needs a bound input, so the day lives in a one-field form; it
 * stores `YYYY-MM-DD`, the local day, which is what the quick picks write.
 * The control has no per-day lower bound, so a day that is not after today
 * is refused inline on submit, as before.
 */
const QuestHoldDialog = (props: QuestHoldDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const form = useForm({
    schema: z.object({ day: z.date().optional() }),
    // Never submitted: the dialog's own button reads the value.
    handler: () => {},
  });
  const values = useFormValues(form);
  const day = typeof values.day === "string" ? values.day : "";
  const setDay = (next: string) => form.input.day.set(next || undefined);

  const today = dt.now().format("YYYY-MM-DD");
  const inFuture = (pick: QuickPick) =>
    dt.now().add(pick.amount, pick.unit).format("YYYY-MM-DD");
  const reasonMissing = !reason.trim();
  const dayInPast = !!day && day <= today;

  const handleClose = (open: boolean) => {
    if (!open) {
      setReason("");
      form.reset();
      setTouched(false);
    }
    props.onOpenChange(open);
  };

  const confirm = () => {
    setTouched(true);
    if (reasonMissing || dayInPast) return;
    // The start of the picked day where the reader is: the hourly sweep
    // lifts it within the hour after.
    const until = day ? new Date(`${day}T00:00:00`).toISOString() : undefined;
    props.onConfirm(reason.trim(), until);
  };

  return (
    <Dialog open={props.open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" data-testid="quest-hold-dialog">
        <DialogHeader>
          <DialogTitle>{tr("quest.view.hold.title")}</DialogTitle>
          <DialogDescription>
            {tr("quest.view.hold.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Textarea
            data-testid="quest-hold-reason"
            aria-label={tr("quest.view.hold.title")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={tr("quest.view.hold.placeholder")}
            disabled={props.submitting}
            rows={3}
          />
          {touched && reasonMissing && (
            <p className="text-danger-text text-xs">
              {tr("quest.view.hold.reasonRequired")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <ControlDate
            input={form.input.day}
            label={tr("quest.view.hold.until")}
            date
            clearable
            disabled={props.submitting}
            inputProps={UNTIL_TRIGGER_PROPS}
          />
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_PICKS.map((pick) => (
              <Button
                key={pick.label}
                type="button"
                variant="outlined"
                size="sm"
                onClick={() => setDay(inFuture(pick))}
                disabled={props.submitting}
                aria-label={tr(pick.long)}
                title={tr(pick.long)}
              >
                {tr(pick.label)}
              </Button>
            ))}
            {day && (
              <Button
                type="button"
                variant="minimal"
                size="sm"
                onClick={() => setDay("")}
                disabled={props.submitting}
              >
                {tr("quest.view.hold.noDate")}
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {tr("quest.view.hold.untilHint")}
          </p>
          {dayInPast && (
            <p className="text-danger-text text-xs">
              {tr("quest.view.hold.untilPast")}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="minimal"
            onClick={() => handleClose(false)}
            disabled={props.submitting}
          >
            {tr("common.cancel")}
          </Button>
          <Button
            type="button"
            data-testid="quest-hold-submit"
            onClick={confirm}
            loading={props.submitting}
          >
            <PauseCircle className="size-4" />
            {tr("quest.view.hold.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface QuickPick {
  amount: number;
  unit: "day" | "week" | "month";
  label:
    | "quest.view.hold.pick.1d"
    | "quest.view.hold.pick.1w"
    | "quest.view.hold.pick.2w"
    | "quest.view.hold.pick.3w"
    | "quest.view.hold.pick.1m";
  long:
    | "quest.view.hold.pick.1dLong"
    | "quest.view.hold.pick.1wLong"
    | "quest.view.hold.pick.2wLong"
    | "quest.view.hold.pick.3wLong"
    | "quest.view.hold.pick.1mLong";
}

// 1D is tomorrow, the earliest day the dialog accepts; 1M is one calendar
// month, not four weeks.
const QUICK_PICKS: QuickPick[] = [
  {
    amount: 1,
    unit: "day",
    label: "quest.view.hold.pick.1d",
    long: "quest.view.hold.pick.1dLong",
  },
  {
    amount: 1,
    unit: "week",
    label: "quest.view.hold.pick.1w",
    long: "quest.view.hold.pick.1wLong",
  },
  {
    amount: 2,
    unit: "week",
    label: "quest.view.hold.pick.2w",
    long: "quest.view.hold.pick.2wLong",
  },
  {
    amount: 3,
    unit: "week",
    label: "quest.view.hold.pick.3w",
    long: "quest.view.hold.pick.3wLong",
  },
  {
    amount: 1,
    unit: "month",
    label: "quest.view.hold.pick.1m",
    long: "quest.view.hold.pick.1mLong",
  },
];

// The kit types `inputProps` as `HTMLAttributes`, which declares no `data-*`
// key, so the test id is asserted onto it.
const UNTIL_TRIGGER_PROPS = {
  "data-testid": "quest-hold-until",
} as HTMLAttributes<HTMLElement>;

export default QuestHoldDialog;
