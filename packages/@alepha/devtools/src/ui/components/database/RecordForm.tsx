import { Copy, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface RecordFormProps {
  entity: any;
  record: any;
  isNew: boolean;
  pkColumn: string;
  /**
   * Returns an error message, or `null` on success.
   */
  onSave: (values: any) => Promise<string | null>;
  onDelete: () => void;
  onDuplicate: (values: any) => void;
  onClose: () => void;
}

/**
 * Annotation shown beside each field name: type, optionality, and what the
 * column is (`pk`, `fk <table>`). It's the schema information you need while
 * filling the field, in the place you need it.
 */
const annotate = (column: any): string => {
  if (!column) return "";
  const bits: string[] = [column.type];
  if (column.nullable) bits[0] = `${column.type}?`;
  if (column.primaryKey) bits.push("· pk");
  else if (column.ref) bits.push(`· fk ${column.ref.entity}`);
  return bits.join(" ");
};

const isGenerated = (c: any): boolean =>
  Boolean(
    c.primaryKey || c.identity || c.createdAt || c.updatedAt || c.version,
  );

const toInput = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const RecordForm = (props: RecordFormProps) => {
  const columns: any[] = props.entity.columns ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const c of columns) {
      next[c.name] = props.isNew ? "" : toInput(props.record?.[c.name]);
    }
    setValues(next);
    setError(null);
  }, [props.record, props.isNew, props.entity.name]);

  /**
   * Coerce back to the column's type before sending. Everything in an input is
   * a string; posting `"true"` for a boolean column or `"3"` for an integer is
   * what makes a save fail validation server-side.
   */
  const payload = useMemo(
    () => (): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const c of columns) {
        if (isGenerated(c)) continue;
        const raw = values[c.name];
        if (raw === undefined || raw === "") continue;
        if (c.type === "boolean") out[c.name] = raw === "true";
        else if (c.type === "integer") out[c.name] = Number.parseInt(raw, 10);
        else if (c.type === "number") out[c.name] = Number(raw);
        else if (c.type === "json" || c.type === "array") {
          try {
            out[c.name] = JSON.parse(raw);
          } catch {
            out[c.name] = raw;
          }
        } else out[c.name] = raw;
      }
      return out;
    },
    [columns, values],
  );

  const submit = async () => {
    setSaving(true);
    setError(null);
    setError(await props.onSave(payload()));
    setSaving(false);
  };

  return (
    <div
      style={{
        width: 340,
        flex: "none",
        borderLeft: "1px solid var(--dt-border)",
        display: "flex",
        flexDirection: "column",
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
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--dt-fg-faint)",
          }}
        >
          Row
        </span>
        <span className="dt-mono" style={{ fontSize: 11 }}>
          {props.isNew
            ? "new"
            : `${props.pkColumn}: ${String(props.record?.[props.pkColumn] ?? "").slice(0, 8)}`}
        </span>
        <button
          type="button"
          className="dt-btn"
          style={{ marginLeft: "auto", padding: "0 6px" }}
          onClick={props.onClose}
        >
          <X size={11} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {columns.map((c) => {
          const generated = isGenerated(c);
          const readOnly = generated;
          return (
            <div key={c.name} style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  marginBottom: 3,
                }}
              >
                <span className="dt-mono" style={{ fontSize: 11 }}>
                  {c.name}
                </span>
                {!c.nullable && !generated && (
                  <span style={{ color: "var(--dt-accent)", fontSize: 11 }}>
                    *
                  </span>
                )}
                <span
                  className="dt-mono"
                  style={{ fontSize: 9, color: "var(--dt-fg-faint)" }}
                >
                  {annotate(c)}
                </span>
              </div>
              <input
                className="dt-input dt-mono"
                readOnly={readOnly}
                style={
                  readOnly ? { opacity: 0.5, cursor: "not-allowed" } : undefined
                }
                value={values[c.name] ?? ""}
                placeholder={readOnly ? "generated" : ""}
                onChange={(e) =>
                  setValues({ ...values, [c.name]: e.currentTarget.value })
                }
              />
            </div>
          );
        })}
      </div>

      {error && (
        <div
          style={{
            padding: "0 12px 8px",
            fontSize: 11,
            color: "var(--dt-error)",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 12,
          borderTop: "1px solid var(--dt-border)",
        }}
      >
        <button
          type="button"
          className="dt-btn"
          data-on="true"
          disabled={saving}
          onClick={submit}
        >
          {saving ? "Saving…" : props.isNew ? "Create" : "Save"}
        </button>
        {!props.isNew && (
          <>
            <button
              type="button"
              className="dt-btn"
              onClick={() => props.onDuplicate(payload())}
            >
              <Copy size={11} /> Duplicate
            </button>
            <button
              type="button"
              className="dt-btn"
              style={{ marginLeft: "auto", color: "var(--dt-error)" }}
              onClick={props.onDelete}
              title="Delete row"
            >
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
