import { useI18n } from "alepha/react/i18n";
import { Lock, LockOpen, ShieldCheck, ShieldX } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import type { SwaggerAccess } from "./useSwaggerAccess.ts";

export interface SwaggerAccessBadgeProps {
  access: SwaggerAccess;
  /**
   * Where to sign in, offered when the operation is gated and nobody is
   * signed in.
   */
  signIn?: string;
}

/**
 * Whether the viewer may call an operation, as a chip: allowed, not allowed,
 * sign in first, or signed in with nothing to check against. Renders nothing
 * for an open operation.
 */
export const SwaggerAccessBadge = (props: SwaggerAccessBadgeProps) => {
  const { tr } = useI18n();

  switch (props.access) {
    case "open":
      return null;
    case "allowed":
      return (
        <Badge variant="tint" tone="success">
          <ShieldCheck />
          {tr("swagger.access.allowed", { default: "You can call this" })}
        </Badge>
      );
    case "denied":
      return (
        <Badge variant="tint" tone="danger">
          <ShieldX />
          {tr("swagger.access.denied", {
            default: "Your permissions do not reach this",
          })}
        </Badge>
      );
    case "anonymous":
      return (
        <Badge
          variant="tint"
          tone="warning"
          render={props.signIn ? <a href={props.signIn} /> : undefined}
        >
          <Lock />
          {tr("swagger.access.signIn", { default: "Sign in to call this" })}
        </Badge>
      );
    case "unknown":
      return (
        <Badge variant="tint" tone="neutral">
          <LockOpen />
          {tr("swagger.access.unknown", {
            default: "Signed in; access checked on call",
          })}
        </Badge>
      );
  }
};
