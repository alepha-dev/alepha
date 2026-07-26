import { Handle, type NodeProps, Position } from "@xyflow/react";
import { KeyRound, Link2 } from "lucide-react";

/**
 * A table in the ERD.
 *
 * Columns stay visible — the shape of a table is the information you came for.
 * In compact mode only keys and relations are kept, which is what makes a
 * 30-table schema legible without losing the join structure.
 */
export const EntityNode = (props: NodeProps) => {
  const data = props.data as any;
  const entity = data.entity;
  const compact: boolean = data.compact ?? false;
  const dimmed: boolean = data.dimmed ?? false;

  const columns: any[] = entity.columns ?? [];
  const shown = compact
    ? columns.filter((c) => c.primaryKey || c.ref)
    : columns;

  return (
    <div
      className="dt-node"
      data-selected={data.selected || undefined}
      style={dimmed ? { opacity: 0.28 } : undefined}
    >
      <Handle type="target" position={Position.Top} />

      <div className="dt-node-head">
        <span className="dt-node-name">{entity.name}</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--dt-mono)",
            fontSize: 9,
            color: "var(--dt-fg-faint)",
          }}
        >
          {/*
           * Which database this table lives in. An app can register more than
           * one provider, and "these two tables cannot be joined" is a fact
           * the diagram otherwise hides.
           */}
          {entity.provider ?? `${columns.length} cols`}
        </span>
      </div>

      {shown.map((col) => (
        <div key={col.name} className="dt-node-col">
          {col.primaryKey ? (
            <KeyRound size={9} style={{ color: "var(--dt-patch)" }} />
          ) : col.ref ? (
            <Link2 size={9} style={{ color: "var(--dt-info)" }} />
          ) : (
            <span style={{ width: 9, flex: "none" }} />
          )}
          <span
            style={{
              color: col.nullable ? "var(--dt-fg-faint)" : "var(--dt-fg)",
            }}
          >
            {col.name}
          </span>
          <span style={{ marginLeft: "auto", color: "var(--dt-fg-faint)" }}>
            {col.type}
          </span>
        </div>
      ))}

      {compact && shown.length < columns.length && (
        <div
          className="dt-node-col"
          style={{ color: "var(--dt-fg-faint)", fontStyle: "italic" }}
        >
          <span style={{ width: 9, flex: "none" }} />+
          {columns.length - shown.length} more
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};
