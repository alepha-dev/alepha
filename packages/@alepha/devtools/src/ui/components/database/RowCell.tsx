import { Link2 } from "lucide-react";

import { toText } from "../shared/toText.ts";

export interface RowCellProps {
  value: unknown;
  column: any;
  onFollow?: (entity: string, id: string) => void;
}

const relative = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

/**
 * One grid cell, rendered by column type.
 *
 * A table of `String(value)` is technically complete and practically unusable:
 * a uuid, a timestamp and a boolean all look the same. Foreign keys become
 * links, which is what turns the grid into something you can navigate rather
 * than just read.
 */
export const RowCell = (props: RowCellProps) => {
  const { value, column } = props;

  if (value === undefined || value === null) {
    return (
      <span style={{ color: "var(--dt-fg-faint)", fontStyle: "italic" }}>
        NULL
      </span>
    );
  }

  if (column?.ref) {
    const id = toText(value);
    return (
      <button
        type="button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          border: 0,
          background: "none",
          padding: 0,
          font: "inherit",
          color: "var(--dt-info)",
          cursor: "pointer",
        }}
        title={`${column.ref.entity}.${column.ref.column} = ${id}`}
        onClick={(e) => {
          e.stopPropagation();
          props.onFollow?.(column.ref.entity, id);
        }}
      >
        <Link2 size={9} />
        {id.length > 10 ? id.slice(0, 8) : id}
      </button>
    );
  }

  if (column?.primaryKey) {
    const id = toText(value);
    return <span title={id}>{id.length > 10 ? id.slice(0, 8) : id}</span>;
  }

  if (column?.type === "boolean") {
    return (
      <span style={{ color: value ? "var(--dt-get)" : "var(--dt-error)" }}>
        {value ? "✓" : "✗"}
      </span>
    );
  }

  if (column?.type === "enum") {
    return <span className="dt-chip">{toText(value)}</span>;
  }

  if (column?.type === "datetime" || column?.type === "date") {
    const n = typeof value === "number" ? value : Date.parse(toText(value));
    if (!Number.isNaN(n)) {
      return <span title={new Date(n).toISOString()}>{relative(n)}</span>;
    }
  }

  if (typeof value === "object") {
    return (
      <span style={{ color: "var(--dt-fg-faint)" }}>
        {Array.isArray(value) ? `[ ${value.length} ]` : "{ … }"}
      </span>
    );
  }

  return <>{toText(value)}</>;
};
