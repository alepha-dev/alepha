import { useI18n } from "alepha/react/i18n";
import {
  Clock,
  KeyRound,
  Layers,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import type { SwaggerAlephaMetadata } from "./OpenApiSpec.ts";

export interface SwaggerAlephaMetaProps {
  metadata: SwaggerAlephaMetadata;
}

/**
 * What Alepha declared about an operation, from its `x-alepha-*` extensions:
 * the action, who may call it, its middlewares, declared errors and timeout.
 * Renders nothing for an operation that carries none of them.
 */
export const SwaggerAlephaMeta = (props: SwaggerAlephaMetaProps) => {
  const { tr } = useI18n();
  const meta = props.metadata;
  const security = meta.security;

  const rows: Array<{
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
  }> = [];

  if (meta.action) {
    rows.push({
      icon: <Layers />,
      label: tr("swagger.meta.action", { default: "Action" }),
      value: (
        <span className="font-mono text-xs">
          {meta.action.group}.{meta.action.name}
        </span>
      ),
    });
  }

  if (security) {
    const chips = [
      ...(security.roles ?? []).map((role) => ({ kind: "role", value: role })),
      ...(security.permissions ?? []).map((p) => ({ kind: "perm", value: p })),
    ];
    rows.push({
      icon: <ShieldCheck />,
      label: tr("swagger.meta.access", { default: "Access" }),
      value: chips.length ? (
        <span className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <Badge
              key={`${chip.kind}:${chip.value}`}
              variant="tint"
              tone={chip.kind === "role" ? "info" : "warning"}
              className="font-mono"
            >
              {chip.kind === "role" ? <KeyRound /> : null}
              {chip.value}
            </Badge>
          ))}
        </span>
      ) : (
        <span className="text-xs">
          {tr("swagger.meta.signedIn", { default: "Any signed-in user" })}
        </span>
      ),
    });
  }

  if (meta.middlewares?.length) {
    rows.push({
      icon: <Layers />,
      label: tr("swagger.meta.middlewares", { default: "Middlewares" }),
      value: (
        <span className="flex flex-wrap gap-1">
          {meta.middlewares.map((name, index) => (
            <Badge
              key={`${name}-${index}`}
              variant="outline"
              className="font-mono"
            >
              {name}
            </Badge>
          ))}
        </span>
      ),
    });
  }

  if (meta.errors?.length) {
    rows.push({
      icon: <TriangleAlert />,
      label: tr("swagger.meta.errors", { default: "Declared errors" }),
      value: (
        <span className="flex flex-wrap gap-1">
          {meta.errors.map((code) => (
            <Badge
              key={code}
              variant="tint"
              tone="danger"
              className="font-mono"
            >
              {code}
            </Badge>
          ))}
        </span>
      ),
    });
  }

  if (meta.timeout !== undefined) {
    rows.push({
      icon: <Clock />,
      label: tr("swagger.meta.timeout", { default: "Timeout" }),
      value: <span className="font-mono text-xs">{meta.timeout} ms</span>,
    });
  }

  if (!rows.length) {
    return null;
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-lg border p-3 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground flex items-center gap-1.5 text-xs [&>svg]:size-3.5">
            {row.icon}
            {row.label}
          </dt>
          <dd className="min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
};
