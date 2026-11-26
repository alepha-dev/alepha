import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Activity, FlaskConical, Globe, Server } from "lucide-react";

import type { ProjectErrorKind } from "../../../../../api/schemas/projectErrorKindSchema.ts";

export interface ProjectErrorOriginBadgeProps {
  origin: "client" | "server" | "run";
  /**
   * What wrote the error, when the caller knows it (the error's page does,
   * the inbox does not): a monitor's outage says `server` as its origin and
   * is told apart by its kind alone.
   */
  kind?: ProjectErrorKind;
}

/**
 * Where an error came from: a browser, a server, a monitor or a use case
 * run. The shared tint Badge, a tone and a glyph each (#Q4261).
 */
const ProjectErrorOriginBadge = (props: ProjectErrorOriginBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  if (props.kind === "uptime") {
    return (
      <Badge variant="tint" tone="amber" data-testid="error-origin">
        <Activity className="size-3" />
        {tr("errors.origin.monitor")}
      </Badge>
    );
  }
  if (props.origin === "run") {
    return (
      <Badge variant="tint" tone="green" data-testid="error-origin">
        <FlaskConical className="size-3" />
        {tr("errors.origin.run")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="tint"
      tone={props.origin === "server" ? "blue" : "violet"}
      data-testid="error-origin"
    >
      {props.origin === "server" ? (
        <Server className="size-3" />
      ) : (
        <Globe className="size-3" />
      )}
      {tr(`errors.origin.${props.origin}`)}
    </Badge>
  );
};

export default ProjectErrorOriginBadge;
