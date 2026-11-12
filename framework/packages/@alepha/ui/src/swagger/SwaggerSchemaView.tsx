import { useI18n } from "alepha/react/i18n";
import { ChevronRight } from "lucide-react";

import { cn } from "../core/utils.ts";
import type { OpenApiSpec } from "./OpenApiSpec.ts";

export interface SwaggerSchemaViewProps {
  spec: OpenApiSpec;
  schema: any;
  /**
   * How deep this view sits. Past {@link SWAGGER_SCHEMA_MAX_DEPTH} the viewer
   * stops opening, which is what keeps a recursive schema finite.
   */
  depth?: number;
}

/**
 * A JSON schema as a tree of fields: name, type, a required mark and the
 * description, each object or array field opening on a click.
 *
 * Native `<details>`, so it opens without JavaScript and server-renders as
 * it will look; a `$ref` is followed one level at a time, only when opened.
 */
export const SwaggerSchemaView = (props: SwaggerSchemaViewProps) => {
  const { tr } = useI18n();
  const depth = props.depth ?? 0;
  const schema = props.spec.resolve(props.schema);

  if (!schema || typeof schema !== "object") {
    return null;
  }

  if (schema.items) {
    return (
      <SwaggerSchemaView
        spec={props.spec}
        schema={schema.items}
        depth={depth}
      />
    );
  }

  const variants: any[] | undefined =
    schema.oneOf ?? schema.anyOf ?? schema.allOf;
  if (Array.isArray(variants)) {
    return (
      <div className="flex flex-col gap-2">
        {variants.map((variant, index) => (
          <div key={index} className="rounded-md border border-dashed p-2">
            <div className="text-muted-foreground mb-1 font-mono text-xs">
              {props.spec.typeLabel(variant)}
            </div>
            {props.spec.isExpandable(variant) &&
              depth < SWAGGER_SCHEMA_MAX_DEPTH && (
                <SwaggerSchemaView
                  spec={props.spec}
                  schema={variant}
                  depth={depth + 1}
                />
              )}
          </div>
        ))}
      </div>
    );
  }

  const properties = Object.entries<any>(schema.properties ?? {});
  if (!properties.length) {
    return (
      <div className="text-muted-foreground font-mono text-xs">
        {props.spec.typeLabel(schema)}
      </div>
    );
  }

  const required = new Set<string>(schema.required ?? []);

  return (
    <ul className={cn("flex flex-col", depth > 0 && "border-s ps-3")}>
      {properties.map(([name, field]) => {
        const resolved = props.spec.resolve(field);
        const description = field?.description ?? resolved?.description;
        const expandable =
          props.spec.isExpandable(field) && depth < SWAGGER_SCHEMA_MAX_DEPTH;
        const head = (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
            <span className="font-mono text-sm font-medium">{name}</span>
            <span className="text-muted-foreground font-mono text-xs break-all">
              {props.spec.typeLabel(field)}
            </span>
            {required.has(name) && (
              <span className="text-danger-text text-xs">
                {tr("swagger.schema.required", { default: "required" })}
              </span>
            )}
            {resolved?.deprecated && (
              <span className="text-muted-foreground text-xs line-through">
                {tr("swagger.deprecated", { default: "deprecated" })}
              </span>
            )}
            {description && (
              <span className="text-muted-foreground basis-full text-xs">
                {description}
              </span>
            )}
          </span>
        );
        return (
          <li key={name}>
            {expandable ? (
              <details className="group/field">
                <summary className="hover:bg-hover flex cursor-pointer list-none items-start gap-1 rounded-sm [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="text-muted-foreground mt-1.5 size-3.5 shrink-0 transition-transform group-open/field:rotate-90 rtl:-scale-x-100 rtl:group-open/field:-rotate-90" />
                  {head}
                </summary>
                <div className="ps-4 pb-1">
                  <SwaggerSchemaView
                    spec={props.spec}
                    schema={field}
                    depth={depth + 1}
                  />
                </div>
              </details>
            ) : (
              <div className="flex items-start gap-1 ps-4.5">{head}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const SWAGGER_SCHEMA_MAX_DEPTH = 12;
