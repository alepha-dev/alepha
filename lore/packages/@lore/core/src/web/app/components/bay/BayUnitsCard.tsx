import { Badge, Card, CardContent } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { HostInventoryUnit } from "../../../../api/schemas/hostInventoryUnitSchema.ts";
import type { I18n } from "../../services/I18n.ts";

export interface BayUnitsCardProps {
  units: HostInventoryUnit[];
}

/**
 * The systemd units the host watches (#Q4422), as Bay last read them: one
 * row per unit, its state as a badge and since when. Green for `active`, red
 * for `failed` or a unit the machine does not have, amber for the moves in
 * between (`activating` is a restart or a deploy under way).
 */
const BayUnitsCard = (props: BayUnitsCardProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const tone = (state: string): "success" | "danger" | "warning" =>
    state === "active"
      ? "success"
      : state === "failed" || state === "not-found"
        ? "danger"
        : "warning";
  return (
    <Card data-testid="bay-overview-units">
      <CardContent className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{tr("bay.units.title")}</h3>
        <ul className="flex flex-col divide-y text-sm">
          {props.units.map((unit) => (
            <li
              key={unit.name}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span className="font-mono text-xs">{unit.name}</span>
              <span className="flex items-center gap-2">
                {unit.since ? (
                  <span className="text-muted-foreground text-xs">
                    {tr("bay.units.since", {
                      args: [l(unit.since, { date: "fromNow" })],
                    })}
                  </span>
                ) : null}
                <Badge variant="tint" tone={tone(unit.activeState)}>
                  {unit.subState
                    ? `${unit.activeState} (${unit.subState})`
                    : unit.activeState}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

export default BayUnitsCard;
