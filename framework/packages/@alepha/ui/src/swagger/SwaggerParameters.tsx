import { useI18n } from "alepha/react/i18n";
import type { OpenApiOperation } from "alepha/server/swagger";

import type { OpenApiSpec } from "./OpenApiSpec.ts";

export interface SwaggerParametersProps {
  spec: OpenApiSpec;
  parameters: NonNullable<OpenApiOperation["parameters"]>;
}

/**
 * The path, query and header parameters of an operation, one row each.
 */
export const SwaggerParameters = (props: SwaggerParametersProps) => {
  const { tr } = useI18n();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground bg-muted/40 text-start text-xs">
          <tr>
            <th className="px-3 py-2 font-medium">
              {tr("swagger.parameters.name", { default: "Name" })}
            </th>
            <th className="px-3 py-2 font-medium">
              {tr("swagger.parameters.in", { default: "In" })}
            </th>
            <th className="px-3 py-2 font-medium">
              {tr("swagger.parameters.type", { default: "Type" })}
            </th>
            <th className="px-3 py-2 font-medium">
              {tr("swagger.parameters.description", { default: "Description" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.parameters.map((param) => {
            const resolved = props.spec.resolve(param.schema);
            const example = (param as { example?: unknown }).example;
            return (
              <tr key={`${param.in}:${param.name}`} className="border-t">
                <td className="px-3 py-2 align-top">
                  <span className="font-mono">{param.name}</span>
                  {param.required && (
                    <span className="text-danger-text ms-1" aria-hidden>
                      *
                    </span>
                  )}
                </td>
                <td className="text-muted-foreground px-3 py-2 align-top text-xs">
                  {param.in}
                </td>
                <td className="text-muted-foreground px-3 py-2 align-top font-mono text-xs break-all">
                  {props.spec.typeLabel(param.schema)}
                </td>
                <td className="px-3 py-2 align-top text-xs">
                  {param.description ?? resolved?.description}
                  {example !== undefined && (
                    <div className="text-muted-foreground mt-0.5">
                      {tr("swagger.parameters.example", { default: "Example" })}
                      {": "}
                      <code className="font-mono">
                        {JSON.stringify(example)}
                      </code>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
