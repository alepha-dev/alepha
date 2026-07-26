import type { ReactNode } from "react";

export interface DetailField {
  label: string;
  value: ReactNode;
}

export interface DetailFieldsProps {
  fields: DetailField[];
}

/**
 * Key/value rows for a detail panel. Rows whose value is nullish are dropped,
 * so a panel only shows what the primitive actually declared.
 */
export const DetailFields = (props: DetailFieldsProps) => {
  const rows = props.fields.filter(
    (f) => f.value !== undefined && f.value !== null && f.value !== "",
  );
  if (rows.length === 0) return null;

  return (
    <div>
      {rows.map((f) => (
        <div
          key={f.label}
          style={{
            display: "flex",
            gap: 16,
            padding: "5px 14px",
            fontSize: 11,
            borderBottom: "1px solid var(--dt-border-soft)",
          }}
        >
          <span
            style={{ width: 150, flex: "none", color: "var(--dt-fg-faint)" }}
          >
            {f.label}
          </span>
          <span className="dt-mono" style={{ color: "var(--dt-fg)" }}>
            {f.value}
          </span>
        </div>
      ))}
    </div>
  );
};
