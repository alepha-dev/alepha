import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../services/I18n.ts";

export interface BayWatchUnitsFieldProps {
  /** The units the host watches now. */
  units: string[];
  busy: boolean;
  /** This field's own save is running: its button spins. */
  saving?: boolean;
  /** Saves the list as typed; the server normalises and refuses bad names. */
  onSave: (units: string[]) => void;
}

/**
 * The systemd units a host watches (#Q4422), typed as one comma-separated
 * line: Bay reports their state and every change. A one-field `useForm`,
 * because a field is always a `Control`, saved by its button rather than on
 * every keystroke.
 */
const BayWatchUnitsField = (props: BayWatchUnitsFieldProps) => {
  const { tr } = useI18n<I18n, "en">();
  const current = props.units.join(", ");
  const form = useForm({
    schema: z.object({ units: z.string().max(4000) }),
    initialValues: { units: current },
    handler: async () => {},
  });
  const values = useFormValues(form);
  const typed = String(values.units ?? "");

  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="flex flex-col gap-0.5">
        <span>{tr("bay.units.label")}</span>
        <span className="text-muted-foreground text-xs">
          {tr("bay.units.description")}
        </span>
      </span>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Control
            input={form.input.units}
            label=""
            inputProps={{
              "data-testid": "bay-settings-units",
              "aria-label": tr("bay.units.label"),
            }}
          />
        </div>
        <Button
          variant="outlined"
          size="sm"
          disabled={props.busy || typed.trim() === current}
          loading={props.saving}
          onClick={() =>
            props.onSave(
              typed
                .split(",")
                .map((unit) => unit.trim())
                .filter(Boolean),
            )
          }
          data-testid="bay-settings-units-save"
        >
          {tr("bay.units.save")}
        </Button>
      </div>
    </div>
  );
};

export default BayWatchUnitsField;
