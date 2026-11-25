import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { PauseCircle } from "lucide-react";
import { useState } from "react";

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
 * an optional day the hold lifts on its own, with quick picks for one and
 * two weeks. Without a day the hold waits for somebody to lift it.
 */
const QuestHoldDialog = (props: QuestHoldDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [reason, setReason] = useState("");
  const [day, setDay] = useState("");
  const [touched, setTouched] = useState(false);

  const today = dt.now().format("YYYY-MM-DD");
  const inWeeks = (weeks: number) =>
    dt.now().add(weeks, "week").format("YYYY-MM-DD");
  const reasonMissing = !reason.trim();
  const dayInPast = !!day && day <= today;

  const handleClose = (open: boolean) => {
    if (!open) {
      setReason("");
      setDay("");
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
          <label htmlFor="quest-hold-until" className="text-sm font-medium">
            {tr("quest.view.hold.until")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="quest-hold-until"
              data-testid="quest-hold-until"
              type="date"
              className="w-auto"
              min={dt.now().add(1, "day").format("YYYY-MM-DD")}
              value={day}
              onChange={(event) => setDay(event.target.value)}
              disabled={props.submitting}
            />
            <Button
              type="button"
              variant="outlined"
              size="sm"
              onClick={() => setDay(inWeeks(1))}
              disabled={props.submitting}
            >
              {tr("quest.view.hold.oneWeek")}
            </Button>
            <Button
              type="button"
              variant="outlined"
              size="sm"
              onClick={() => setDay(inWeeks(2))}
              disabled={props.submitting}
            >
              {tr("quest.view.hold.twoWeeks")}
            </Button>
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
            disabled={props.submitting}
          >
            <PauseCircle className="size-4" />
            {tr("quest.view.hold.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QuestHoldDialog;
