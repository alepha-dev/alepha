import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";
import { useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";
import {
  ESTIMATE_PRESETS,
  ESTIMATE_UNITS,
  type EstimateUnit,
  formatEstimate,
  splitEstimate,
} from "./questEstimate.ts";

export interface QuestEstimateInputProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
}

/**
 * Optional time-estimate picker for the quest form. One-tap preset chips
 * (`5m`…`1d`) plus a custom chip that opens a count + unit popover.
 *
 * The custom chip used to reveal a bare minutes spinner under the row, which
 * asked the reader to do the arithmetic: a three-week task had to be entered
 * as 7200. Count plus unit lets them say what they mean, and the chip then
 * shows it back ("303 days") instead of staying a permanent "Custom…" with
 * the real value hidden in a field below.
 *
 * Stored as minutes either way — `quests.estimateMinutes` is unchanged.
 */
const QuestEstimateInput = (props: QuestEstimateInputProps) => {
  const { tr } = useI18n<I18n, "en">();
  const value = props.value ?? null;

  // A value off the preset ladder came from the custom picker, so the chip
  // shows it and reopens on it.
  const isCustom = value != null && !ESTIMATE_PRESETS.includes(value);
  const split = isCustom ? splitEstimate(value) : undefined;

  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<string>(() =>
    split ? String(split.count) : "",
  );
  const [unit, setUnit] = useState<EstimateUnit>(split?.unit ?? "hours");

  const commit = (nextCount: string, nextUnit: EstimateUnit) => {
    const parsed = Number.parseInt(nextCount, 10);
    props.onChange?.(
      Number.isFinite(parsed) && parsed > 0
        ? parsed * ESTIMATE_UNITS[nextUnit]
        : null,
    );
  };

  const unitLabel = (u: EstimateUnit, n: number) =>
    String(
      n === 1
        ? tr(`quest.create.estimate.unit.${u}.one` as never)
        : tr(`quest.create.estimate.unit.${u}` as never),
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ESTIMATE_PRESETS.map((minutes) => (
        <Button
          key={minutes}
          type="button"
          size="sm"
          variant={value === minutes ? "default" : "outline"}
          onClick={() => props.onChange?.(minutes)}
        >
          {formatEstimate(minutes)}
        </Button>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant={isCustom ? "default" : "outline"}
            />
          }
        >
          {split
            ? `${split.count} ${unitLabel(split.unit, split.count)}`
            : tr("quest.create.estimate.custom")}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              autoFocus
              aria-label={tr("quest.create.estimate.count")}
              className="w-20"
              value={count}
              onChange={(e) => {
                setCount(e.target.value);
                commit(e.target.value, unit);
              }}
            />
            <Select
              value={unit}
              onValueChange={(next) => {
                setUnit(next as EstimateUnit);
                commit(count, next as EstimateUnit);
              }}
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ESTIMATE_UNITS) as EstimateUnit[]).map((u) => (
                  <SelectItem key={u} value={u}>
                    {unitLabel(u, 2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>

      {value != null && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={tr("quest.create.estimate.clear")}
          onClick={() => {
            setCount("");
            props.onChange?.(null);
          }}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
};

export default QuestEstimateInput;
