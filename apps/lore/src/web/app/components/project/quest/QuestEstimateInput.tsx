import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";
import { useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";
import { ESTIMATE_PRESETS, formatEstimate } from "./questEstimate.ts";

export interface QuestEstimateInputProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
}

/**
 * Optional time-estimate picker for the quest form. One-tap preset chips
 * (`5m`…`1d`, labels derived from {@link formatEstimate}) plus a `custom…`
 * chip that reveals a minutes input for off-ladder durations. Clearable —
 * no selection means no estimate (`null`). Bound to `estimateMinutes` and
 * rendered through `<Control custom>`, which supplies `{ value, onChange }`.
 */
const QuestEstimateInput = (props: QuestEstimateInputProps) => {
  const { tr } = useI18n<I18n, "en">();
  const value = props.value ?? null;

  // A value that isn't one of the presets must have come from the custom
  // input — start in custom mode so editing an existing quest shows it.
  const [customMode, setCustomMode] = useState(
    () => value != null && !ESTIMATE_PRESETS.includes(value),
  );

  const select = (minutes: number) => {
    setCustomMode(false);
    props.onChange?.(minutes);
  };

  const clear = () => {
    setCustomMode(false);
    props.onChange?.(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {ESTIMATE_PRESETS.map((minutes) => (
          <Button
            key={minutes}
            type="button"
            size="sm"
            variant={!customMode && value === minutes ? "default" : "outline"}
            onClick={() => select(minutes)}
          >
            {formatEstimate(minutes)}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={customMode ? "default" : "outline"}
          onClick={() => setCustomMode(true)}
        >
          {tr("quest.create.estimate.custom")}
        </Button>
        {value != null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={tr("quest.create.estimate.clear")}
            onClick={clear}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {customMode && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            className="w-24"
            value={value ?? ""}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              props.onChange?.(
                Number.isFinite(parsed) && parsed > 0 ? parsed : null,
              );
            }}
          />
          <span className="text-muted-foreground text-sm">
            {tr("quest.create.estimate.minutes")}
          </span>
        </div>
      )}
    </div>
  );
};

export default QuestEstimateInput;
