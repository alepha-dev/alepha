import { useRouter } from "alepha/react/router";
import { ArrowRight } from "lucide-react";

export interface SchemaDetailProps {
  entity: any;
}

const Row = (props: {
  left: string;
  right?: string;
  tags?: Array<{ label: string; tone?: string }>;
  sub?: string;
}) => (
  <div
    style={{
      padding: "5px 12px",
      borderBottom: "1px solid var(--dt-border-soft)",
      fontFamily: "var(--dt-mono)",
      fontSize: 11,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "var(--dt-fg)" }}>{props.left}</span>
      <span
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--dt-fg-faint)",
        }}
      >
        {props.right}
        {props.tags?.map((t) => (
          <span key={t.label} style={{ color: t.tone ?? "var(--dt-fg-faint)" }}>
            {t.label}
          </span>
        ))}
      </span>
    </div>
    {props.sub && (
      <div style={{ color: "var(--dt-fg-faint)", fontSize: 10 }}>
        {props.sub}
      </div>
    )}
  </div>
);

/**
 * Everything the collector knows about one table.
 *
 * Indexes, foreign keys and constraints have always been collected and were
 * never rendered anywhere — this panel is where they surface.
 */
export const SchemaDetail = (props: SchemaDetailProps) => {
  const entity = props.entity;
  const router = useRouter();

  return (
    <div
      style={{
        width: 300,
        flex: "none",
        borderLeft: "1px solid var(--dt-border)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--dt-border)",
        }}
      >
        <span className="dt-mono" style={{ fontSize: 12 }}>
          {entity.name}
        </span>
        <button
          type="button"
          className="dt-btn"
          style={{ marginLeft: "auto" }}
          onClick={() =>
            router.push(`/rows/${encodeURIComponent(entity.name)}`)
          }
        >
          Edit rows <ArrowRight size={10} />
        </button>
      </div>

      <div className="dt-section-label">Columns</div>
      {(entity.columns ?? []).map((c: any) => (
        <Row
          key={c.name}
          left={c.name}
          right={c.type}
          tags={[
            ...(c.primaryKey
              ? [{ label: "primary key", tone: "var(--dt-patch)" }]
              : []),
            ...(c.ref
              ? [{ label: "foreign key", tone: "var(--dt-info)" }]
              : []),
            ...(c.nullable ? [{ label: "nullable" }] : []),
            ...(c.identity ? [{ label: "identity" }] : []),
          ]}
        />
      ))}

      {(entity.indexes ?? []).length > 0 && (
        <>
          <div className="dt-section-label">Indexes</div>
          {entity.indexes.map((idx: any, i: number) => (
            <Row
              key={idx.name ?? i}
              left={idx.name ?? `(${idx.columns.join(", ")})`}
              sub={`(${idx.columns.join(", ")})`}
              tags={
                idx.unique
                  ? [{ label: "unique", tone: "var(--dt-patch)" }]
                  : undefined
              }
            />
          ))}
        </>
      )}

      {(entity.foreignKeys ?? []).length > 0 && (
        <>
          <div className="dt-section-label">Foreign keys</div>
          {entity.foreignKeys.map((fk: any, i: number) => (
            <Row
              key={fk.name ?? i}
              left={fk.columns.join(", ")}
              sub={`→ ${fk.foreignEntity}.${(fk.foreignColumns ?? []).join(", ")}`}
            />
          ))}
        </>
      )}

      {/* Column-level refs carry the cascade rules the table-level list doesn't. */}
      {(entity.columns ?? []).some((c: any) => c.ref) && (
        <>
          <div className="dt-section-label">References</div>
          {(entity.columns ?? [])
            .filter((c: any) => c.ref)
            .map((c: any) => (
              <Row
                key={c.name}
                left={c.name}
                sub={`→ ${c.ref.entity}.${c.ref.column}${
                  c.ref.onDelete ? ` · on delete ${c.ref.onDelete}` : ""
                }`}
              />
            ))}
        </>
      )}

      {(entity.constraints ?? []).length > 0 && (
        <>
          <div className="dt-section-label">Constraints</div>
          {entity.constraints.map((c: any, i: number) => (
            <Row
              key={c.name ?? i}
              left={c.name ?? `(${c.columns.join(", ")})`}
              sub={`(${c.columns.join(", ")})${c.hasCheck ? " · check" : ""}`}
              tags={
                c.unique
                  ? [{ label: "unique", tone: "var(--dt-patch)" }]
                  : undefined
              }
            />
          ))}
        </>
      )}
    </div>
  );
};
