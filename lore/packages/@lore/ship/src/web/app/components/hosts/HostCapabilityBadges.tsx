import { Badge } from "@alepha/ui";
import { BarChart3, Rocket } from "lucide-react";
import type { ReactNode } from "react";

export interface HostCapabilityBadgesProps {
  type: "bay" | "cloudflare";
  deployAllowed?: boolean;
  /**
   * More pills after the built-in ones: the project's Hosts tab adds the
   * Agent role there.
   */
  children?: ReactNode;
}

/**
 * What a host does, as pills (#Q4010), shared by Admin > Hosts and the
 * project's Hosts tab (#Q4047). Stats come from Bay's connector: a
 * cloudflare account reports none, so it carries no stats pill.
 */
const HostCapabilityBadges = (props: HostCapabilityBadgesProps) => {
  const capabilities = [
    ...(props.type === "bay" ? [{ label: "stats", icon: BarChart3 }] : []),
    ...(props.deployAllowed ? [{ label: "deploy", icon: Rocket }] : []),
  ];
  return (
    <span
      className="flex flex-wrap items-center gap-1"
      data-testid="host-capabilities"
    >
      {capabilities.map((capability) => (
        <Badge key={capability.label} variant="tint" tone="neutral">
          <capability.icon className="size-3" aria-hidden="true" />
          {capability.label}
        </Badge>
      ))}
      {props.children}
    </span>
  );
};

export default HostCapabilityBadges;
