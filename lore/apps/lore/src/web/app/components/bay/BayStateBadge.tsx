import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

import type { BayProcessState } from "./bayInstanceRow.ts";

export interface BayStateBadgeProps {
  state: BayProcessState;
}

/**
 * What the process is doing, as one word.
 *
 * ⚠️ Six words rather than up-or-down, and each one is load-bearing. A static
 * site has no process and is healthy; a stop somebody owns is not a crash; a
 * crash past the restart limit is not a stop; a restart in flight is neither.
 * `bay status` refuses to call a static site a problem for the stated reason
 * that a status which always warns is one nobody reads, and this badge holds
 * the same line.
 *
 * The words are Lore's own, drawn from the booleans the machine sends. Its
 * `problems[]` stay verbatim in their own column - two vocabularies on
 * purpose, so an operator comparing this screen to `bay status` on the box
 * sees the machine's own sentence there.
 */
const BayStateBadge = (props: BayStateBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();

  const variant =
    props.state === "running" || props.state === "static"
      ? "secondary"
      : props.state === "crashed"
        ? "destructive"
        : "outline";

  return <Badge variant={variant}>{tr(LABELS[props.state])}</Badge>;
};

export default BayStateBadge;

const LABELS: Record<
  BayProcessState,
  Parameters<ReturnType<typeof useI18n<I18n, "en">>["tr"]>[0]
> = {
  static: "bay.state.static",
  running: "bay.state.running",
  stopped: "bay.state.stopped",
  crashed: "bay.state.crashed",
  restarting: "bay.state.restarting",
  down: "bay.state.down",
  missing: "bay.state.missing",
};
