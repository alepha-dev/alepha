import { Badge } from "@alepha/ui/components/ui/badge";
import type { IntentResource } from "alepha/api/payments";

import {
  PAYMENT_STATUS_ICON,
  PAYMENT_STATUS_TONE,
} from "./admin-payments-status-tones.ts";

export interface AdminPaymentsStatusBadgeProps {
  status: IntentResource["status"];
}

/**
 * A payment intent's status, as a tinted chip with a glyph: the design of
 * the other admin status chips and of Lore's statuses (#Q2247). The tone and
 * the glyph come from `admin-payments-status-tones`.
 *
 * The label is still the raw status, as it was before the chip changed:
 * the payment statuses have no translated labels yet.
 */
export const AdminPaymentsStatusBadge = (
  props: AdminPaymentsStatusBadgeProps,
) => {
  const Icon = PAYMENT_STATUS_ICON[props.status];

  return (
    // A status this build does not know about still gets a chip: neutral,
    // no glyph, its raw value as the label.
    <Badge variant="tint" tone={PAYMENT_STATUS_TONE[props.status] ?? "neutral"}>
      {Icon ? <Icon className="size-3" /> : null}
      {props.status}
    </Badge>
  );
};
