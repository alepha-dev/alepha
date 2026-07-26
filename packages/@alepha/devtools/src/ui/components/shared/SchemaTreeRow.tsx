import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  childEntries,
  constraintChips,
  enumMembers,
  typeLabel,
  unwrapNullable,
} from "./schemaFormat.ts";

export interface SchemaTreeRowProps {
  name: string;
  schema: any;
  required: boolean;
  depth: number;
  /**
   * Rows at or below this depth start expanded. Deeper branches stay collapsed
   * so a large schema opens readable instead of as a wall.
   */
  openDepth: number;
}

export const SchemaTreeRow = (props: SchemaTreeRowProps) => {
  const { schema: inner, nullable } = unwrapNullable(props.schema);
  const children = childEntries(inner);
  const branch = children.length > 0;
  const [open, setOpen] = useState(props.depth < props.openDepth);

  const chips = constraintChips(inner);
  const members = enumMembers(inner);
  const description = inner?.description;

  return (
    <>
      <div
        className="dt-schema-row"
        style={{ paddingLeft: 14 + props.depth * 16 }}
      >
        {branch ? (
          <button
            type="button"
            className="dt-schema-toggle"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : (
          <span className="dt-schema-toggle" />
        )}

        <span className="dt-schema-name">
          {props.name}
          {props.required && <span className="dt-schema-req">*</span>}
        </span>

        <span className="dt-schema-type">
          {typeLabel(inner)}
          {nullable && "?"}
        </span>

        {members.shown.length > 0 && (
          <span className="dt-schema-type" style={{ color: "var(--dt-info)" }}>
            {members.shown.join(" │ ")}
            {members.extra > 0 && ` +${members.extra}`}
          </span>
        )}

        {chips.map((chip) => (
          <span key={chip.label} className="dt-chip">
            {chip.label}
          </span>
        ))}

        {description && <span className="dt-schema-desc">{description}</span>}
      </div>

      {branch &&
        open &&
        children.map((child) => (
          <SchemaTreeRow
            key={child.name}
            name={child.name}
            schema={child.schema}
            required={child.required}
            depth={props.depth + 1}
            openDepth={props.openDepth}
          />
        ))}
    </>
  );
};
