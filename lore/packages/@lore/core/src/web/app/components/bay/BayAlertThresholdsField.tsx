import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../services/I18n.ts";

export interface BayAlertThresholdsFieldProps {
  disk?: number;
  memory?: number;
  busy: boolean;
  /** Saves both limits; `null` turns one off. */
  onSave: (limits: { disk: number | null; memory: number | null }) => void;
}

/**
 * The host's disk and memory thresholds (#Q4423), in percent: a reading at
 * or above one raises `host.resource_high`, once, until it falls back under.
 * Empty is off. Saved by the button, like the watched units.
 */
const BayAlertThresholdsField = (props: BayAlertThresholdsFieldProps) => {
  const { tr } = useI18n<I18n, "en">();
  const form = useForm({
    schema: z.object({
      disk: z.integer().min(1).max(100).optional(),
      memory: z.integer().min(1).max(100).optional(),
    }),
    initialValues: { disk: props.disk, memory: props.memory },
    handler: async () => {},
  });
  const values = useFormValues(form);
  const disk = values.disk === undefined ? null : Number(values.disk);
  const memory = values.memory === undefined ? null : Number(values.memory);
  const unchanged =
    disk === (props.disk ?? null) && memory === (props.memory ?? null);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="flex flex-col gap-0.5">
        <span>{tr("bay.alerts.label")}</span>
        <span className="text-muted-foreground text-xs">
          {tr("bay.alerts.description")}
        </span>
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <Control
          number
          input={form.input.disk}
          label={tr("bay.alerts.disk")}
          inputProps={{ "data-testid": "bay-settings-alert-disk" }}
        />
        <Control
          number
          input={form.input.memory}
          label={tr("bay.alerts.memory")}
          inputProps={{ "data-testid": "bay-settings-alert-memory" }}
        />
        <Button
          variant="outlined"
          size="sm"
          disabled={props.busy || unchanged}
          onClick={() => props.onSave({ disk, memory })}
          data-testid="bay-settings-alerts-save"
        >
          {tr("bay.units.save")}
        </Button>
      </div>
    </div>
  );
};

export default BayAlertThresholdsField;
