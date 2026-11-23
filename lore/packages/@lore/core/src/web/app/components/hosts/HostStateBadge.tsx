import { Badge } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { CircleDot } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";

export interface HostStateBadgeProps {
  type: "bay" | "cloudflare";
  online?: boolean;
  credentialStatus?: "valid" | "invalid";
}

/**
 * Online or offline, nothing else (#Q4010). A cloudflare account never
 * connects, so `online` says nothing about one: whether its credential still
 * works does (#1630), and a valid one reads online. Shared by Admin > Hosts
 * and the project's Hosts tab (#Q4047).
 */
const HostStateBadge = (props: HostStateBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const online =
    props.type === "cloudflare"
      ? props.credentialStatus === "valid"
      : props.online === true;
  return (
    <Badge
      variant="tint"
      tone={online ? "success" : "neutral"}
      data-testid="host-state"
    >
      <CircleDot className="size-3" aria-hidden="true" />
      {online ? tr("hosts.online") : tr("hosts.offline")}
    </Badge>
  );
};

export default HostStateBadge;
