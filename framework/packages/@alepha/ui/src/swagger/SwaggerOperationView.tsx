import { useI18n } from "alepha/react/i18n";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "../core/Badge.tsx";
import type { OpenApiSpec, SwaggerEntry } from "./OpenApiSpec.ts";
import { SwaggerAlephaMeta } from "./SwaggerAlephaMeta.tsx";
import { SwaggerMethodBadge } from "./SwaggerMethodBadge.tsx";
import { SwaggerParameters } from "./SwaggerParameters.tsx";
import { SwaggerResponses } from "./SwaggerResponses.tsx";
import { SwaggerSchemaView } from "./SwaggerSchemaView.tsx";
import { SwaggerSection } from "./SwaggerSection.tsx";

export interface SwaggerOperationViewProps {
  spec: OpenApiSpec;
  entry: SwaggerEntry;
  /**
   * Shown at the end of the header line: where the explorer says whether the
   * viewer may call the operation.
   */
  badge?: ReactNode;
  /**
   * Rendered under the header, before the reference sections: where the
   * explorer puts its request panel.
   */
  children?: ReactNode;
}

/**
 * One operation in full: method and path, summary and description, what
 * Alepha declared about it, then its parameters, request body and responses.
 */
export const SwaggerOperationView = (props: SwaggerOperationViewProps) => {
  const { tr } = useI18n();
  const { spec, entry } = props;
  const operation = entry.operation;
  const body = Object.entries(operation.requestBody?.content ?? {});

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SwaggerMethodBadge method={entry.method} />
          <code className="font-mono text-sm break-all">{entry.path}</code>
          {spec.isSecured(operation) && (
            <Lock
              className="text-muted-foreground size-3.5"
              aria-label={tr("swagger.secured", {
                default: "Requires sign-in",
              })}
            />
          )}
          {props.badge}
          {operation.deprecated && (
            <Badge variant="tint" tone="warning">
              {tr("swagger.deprecated", { default: "deprecated" })}
            </Badge>
          )}
        </div>
        {operation.summary && (
          <h2 className="text-lg font-semibold">{operation.summary}</h2>
        )}
        {operation.description && (
          <p className="text-muted-foreground text-sm whitespace-pre-line">
            {operation.description}
          </p>
        )}
      </header>

      <SwaggerAlephaMeta metadata={spec.metadata(operation)} />

      {props.children}

      {operation.parameters?.length ? (
        <SwaggerSection
          title={tr("swagger.section.parameters", { default: "Parameters" })}
        >
          <SwaggerParameters spec={spec} parameters={operation.parameters} />
        </SwaggerSection>
      ) : null}

      {body.length ? (
        <SwaggerSection
          title={tr("swagger.section.body", { default: "Request body" })}
          aside={body.map(([type]) => type).join(", ")}
        >
          {body.map(([type, media]) => (
            <div key={type} className="rounded-lg border p-3">
              <SwaggerSchemaView spec={spec} schema={media.schema} />
            </div>
          ))}
        </SwaggerSection>
      ) : null}

      <SwaggerSection
        title={tr("swagger.section.responses", { default: "Responses" })}
      >
        <SwaggerResponses spec={spec} responses={operation.responses} />
      </SwaggerSection>
    </article>
  );
};
