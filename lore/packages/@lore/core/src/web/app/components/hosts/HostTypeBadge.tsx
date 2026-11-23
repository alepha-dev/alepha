import { Badge } from "@alepha/ui";
import { Cloud, Server } from "lucide-react";

export interface HostTypeBadgeProps {
  type: "bay" | "cloudflare";
}

/**
 * A host's type, as the tag pill of the quests pages (#Q3941), with a leading
 * icon (#Q4010). One component for Admin > Hosts and the project's Hosts tab
 * (#Q4047), so the two read alike.
 *
 * Each type has its own hue (#Q4048), so the two tell apart at a glance:
 * Cloudflare's orange, Bay blue. Hue tones, not semantic ones: a type is a
 * kind, not a success or a warning.
 */
const HostTypeBadge = (props: HostTypeBadgeProps) => {
  const Icon = props.type === "cloudflare" ? Cloud : Server;
  return (
    <Badge
      variant="tint"
      tone={props.type === "cloudflare" ? "orange" : "blue"}
      data-testid="host-type"
    >
      <Icon className="size-3" aria-hidden="true" />
      {props.type}
    </Badge>
  );
};

export default HostTypeBadge;
