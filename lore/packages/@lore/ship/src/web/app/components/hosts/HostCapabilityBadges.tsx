import { Badge } from "@alepha/ui";
import { HostRoleRegistry, type I18n } from "@lore/core/web";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

export interface HostCapabilityBadgesProps {
  type: "bay" | "cloudflare";
  deployAllowed?: boolean;
  /**
   * Whether the host is an Agent host where it is shown, and the project's
   * default one: the project's Hosts tab knows, Admin > Hosts does not.
   */
  agent?: "default" | "available";
  /**
   * More pills after the roles.
   */
  children?: ReactNode;
}

/**
 * What a host does, as pills (#Q4010), shared by Admin > Hosts and the
 * project's Hosts tab (#Q4047): one per role of core's `HostRoleRegistry`
 * that applies (#E166), stats and agent from core, deploy from Ship.
 */
const HostCapabilityBadges = (props: HostCapabilityBadgesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const roles = useInject(HostRoleRegistry).of(props);
  return (
    <span
      className="flex flex-wrap items-center gap-1"
      data-testid="host-capabilities"
    >
      {roles.map((role) => (
        <Badge
          key={role.key}
          variant="tint"
          tone={role.tone?.(props) ?? "neutral"}
          data-testid={role.testId}
          data-default={role.isDefault?.(props) ? "true" : undefined}
        >
          <role.icon className="size-3" aria-hidden="true" />
          {role.label(props, tr)}
        </Badge>
      ))}
      {props.children}
    </span>
  );
};

export default HostCapabilityBadges;
