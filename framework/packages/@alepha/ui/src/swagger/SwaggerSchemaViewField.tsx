import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface SwaggerSchemaViewFieldProps {
  /**
   * The field's line: name, type, marks and description.
   */
  head: ReactNode;
  /**
   * The field's nested schema, rendered once the field has been opened.
   */
  children: ReactNode;
}

/**
 * One expandable field of a {@link SwaggerSchemaView}: its children render
 * once it has been opened, never while closed, so a recursive schema costs
 * one level per click.
 */
export const SwaggerSchemaViewField = (props: SwaggerSchemaViewFieldProps) => {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="group/field"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="hover:bg-hover flex cursor-pointer list-none items-start gap-1 rounded-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="text-muted-foreground mt-1.5 size-3.5 shrink-0 transition-transform group-open/field:rotate-90 rtl:-scale-x-100 rtl:group-open/field:-rotate-90" />
        {props.head}
      </summary>
      {opened && <div className="ps-4 pb-1">{props.children}</div>}
    </details>
  );
};
