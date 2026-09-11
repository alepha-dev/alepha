import type { BadgeTone } from "@alepha/ui/components/ui/badge";
import type { IntentResource } from "alepha/api/payments";
import {
  Ban,
  Circle,
  CircleCheck,
  CircleMinus,
  CircleX,
  Hourglass,
  RotateCcw,
  ShieldCheck,
  TimerOff,
  Undo2,
  type LucideIcon,
} from "lucide-react";

type PaymentStatus = IntentResource["status"];

/**
 * The tone each payment intent status wears, on the scale Lore's statuses
 * and the other admin chips use (#Q2247): not started is `info`, in flight
 * is `warning`, done is `success`, failed is `danger`, and `neutral` is a
 * settled state nobody needs to act on.
 *
 * ⚠️ `voided`, `cancelled`, `expired` and the two refund states are
 * `neutral`, where the old badge made the first three `destructive`. Each is
 * a flow that ended on purpose or by timeout, not a fault: the one status
 * that means something went wrong is `failed`, and it is the only red chip.
 *
 * A `Record` over the status union, so a status added to the entity is a
 * type error here rather than a chip that silently falls back.
 */
export const PAYMENT_STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  created: "info",
  processing: "warning",
  authorized: "warning",
  captured: "success",
  partially_refunded: "neutral",
  refunded: "neutral",
  voided: "neutral",
  cancelled: "neutral",
  expired: "neutral",
  failed: "danger",
};

/**
 * The glyph each status wears. Five statuses share `neutral`, so the glyph
 * is what separates a refund from a void from an expiry, in colour or not.
 */
export const PAYMENT_STATUS_ICON: Record<PaymentStatus, LucideIcon> = {
  created: Circle,
  processing: Hourglass,
  authorized: ShieldCheck,
  captured: CircleCheck,
  partially_refunded: RotateCcw,
  refunded: Undo2,
  voided: Ban,
  cancelled: CircleMinus,
  expired: TimerOff,
  failed: CircleX,
};
