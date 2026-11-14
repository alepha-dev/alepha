import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

import { Badge } from "../core/Badge.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";
import {
  adminStatTileDelta,
  formatAdminStatTileDelta,
} from "./adminStatTileDelta.ts";

export interface AdminStatTileDeltaChipProps {
  current: number;
  previous: number;
  /**
   * What is compared, shown as the chip's tooltip and read out after it.
   */
  label: ReactNode;
}

/**
 * The `+12%` chip beside a stat tile's number.
 *
 * Neutral on purpose: whether a rise is good depends on the number (more
 * users, more failed sign-ins), and the tile's `alert` predicate is the one
 * place that says a value is bad.
 */
export const AdminStatTileDeltaChip = (props: AdminStatTileDeltaChipProps) => {
  const { tr } = useI18n();
  const text = formatAdminStatTileDelta(
    adminStatTileDelta(props.current, props.previous),
    tr("admin.dashboard.deltaNew", { default: "new" }),
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="tint"
            tone="neutral"
            data-slot="stat-delta"
            className="cursor-help tabular-nums"
          />
        }
      >
        {text}
        <span className="sr-only"> ({props.label})</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{props.label}</TooltipContent>
    </Tooltip>
  );
};
