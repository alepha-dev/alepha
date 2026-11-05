import type { OpenApiOperation } from "alepha/server/swagger";
import { ChevronRight } from "lucide-react";

import { Badge, type BadgeTone } from "../core/Badge.tsx";
import type { OpenApiSpec } from "./OpenApiSpec.ts";
import { SwaggerSchemaView } from "./SwaggerSchemaView.tsx";

export interface SwaggerResponsesProps {
  spec: OpenApiSpec;
  responses: OpenApiOperation["responses"];
}

/**
 * The responses of an operation by status, each opening on its content
 * schema. Statuses sort numerically, `default` last.
 */
export const SwaggerResponses = (props: SwaggerResponsesProps) => {
  const statuses = Object.keys(props.responses).sort((a, b) =>
    a === "default" ? 1 : b === "default" ? -1 : Number(a) - Number(b),
  );
  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {statuses.map((status) => {
        const response = props.responses[status];
        const content = Object.entries(response?.content ?? {});
        const head = (
          <span className="flex items-center gap-2 px-3 py-2">
            <Badge
              variant="tint"
              tone={swaggerStatusTone(status)}
              className="w-12 font-mono"
            >
              {status}
            </Badge>
            <span className="text-sm">{response?.description}</span>
            {content.map(([type]) => (
              <span
                key={type}
                className="text-muted-foreground ml-auto font-mono text-xs"
              >
                {type}
              </span>
            ))}
          </span>
        );
        if (!content.some(([, media]) => media?.schema)) {
          return (
            <div key={status} className="pl-5">
              {head}
            </div>
          );
        }
        return (
          <details key={status} className="group/response">
            <summary className="hover:bg-hover flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
              <ChevronRight className="text-muted-foreground ml-1.5 size-3.5 shrink-0 transition-transform group-open/response:rotate-90" />
              <span className="min-w-0 flex-1">{head}</span>
            </summary>
            <div className="flex flex-col gap-3 px-4 pb-3">
              {content.map(([type, media]) => (
                <div key={type} className="flex flex-col gap-1">
                  <span className="text-muted-foreground font-mono text-xs">
                    {props.spec.typeLabel(media?.schema)}
                  </span>
                  <SwaggerSchemaView spec={props.spec} schema={media?.schema} />
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
};

const swaggerStatusTone = (status: string): BadgeTone => {
  const code = Number(status);
  if (code >= 200 && code < 300) return "success";
  if (code >= 300 && code < 400) return "info";
  if (code >= 400 && code < 500) return "warning";
  if (code >= 500) return "danger";
  return "neutral";
};
