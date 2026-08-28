import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface QuestDueDateInputProps {
  value?: string | null;
  onChange?: (value: string | null) => void;
}

/**
 * Deadline picker for the quest form.
 *
 * A native `<input type="date">` rather than a calendar popover: a deadline
 * is a date somebody already knows, so the browser's own picker (and its
 * keyboard entry, and its locale) beats a custom widget here.
 *
 * ⚠️ The column is a datetime and the input is a date, so the two need
 * converting in both directions. The conversion is deliberately *local*:
 * `toISOString()` on a date-only value would shift it a day backwards for
 * anyone west of UTC, which is the classic way a deadline silently moves.
 * Day-granularity is stored as the END of the chosen day, so "due Friday"
 * is not overdue at one minute past midnight on Friday.
 *
 * Clearing sends `null`, which is what `updateQuestById` reads as "clear
 * it"; omitting the key instead would leave the old deadline in place.
 */
const QuestDueDateInput = (props: QuestDueDateInputProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);

  // `YYYY-MM-DD` in the reader's own timezone, which is what the input wants.
  const asDateInput = props.value
    ? dt.of(props.value).format("YYYY-MM-DD")
    : "";

  const handleChange = (next: string) => {
    if (!next) {
      props.onChange?.(null);
      return;
    }
    // End of the chosen day, local time, then serialized as an instant.
    const end = dt.of(next).endOf("day");
    props.onChange?.(end.toDate().toISOString());
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        value={asDateInput}
        data-testid="quest-due-input"
        onChange={(e) => handleChange(e.currentTarget.value)}
        className="h-9 w-auto"
      />
      {props.value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={tr("quest.create.due.clear")}
          onClick={() => props.onChange?.(null)}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
};

export default QuestDueDateInput;
