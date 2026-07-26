import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { jsonSchemaToZod, z } from "alepha";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { HttpClient } from "alepha/server";
import { RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DevAtomMetadata } from "../../../schemas/DevAtomMetadata.ts";
import { SchemaTree } from "../shared/SchemaTree.tsx";
import { AtomMutations } from "./AtomMutations.tsx";

export interface AtomDetailProps {
  atom: DevAtomMetadata;
  onSaved: () => void;
}

export const AtomDetail = (props: AtomDetailProps) => {
  const atom = props.atom;
  const http = useInject(HttpClient);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const current = atom.currentValue ?? atom.defaultValue;

  /**
   * Object-shaped atoms get the same `AutoForm` the action Try It tab and the
   * record editor use, replacing a bespoke recursive editor that only knew
   * object/boolean/number/enum/string. Everything else falls back to JSON.
   */
  const formSchema = useMemo(() => {
    if (!atom.schema || atom.serverOnly) return null;
    try {
      const converted = jsonSchemaToZod(atom.schema);
      return converted && z.schema.isObject(converted) ? converted : null;
    } catch {
      return null;
    }
  }, [atom]);

  const form = useForm(
    {
      schema: formSchema ?? z.object({}),
      handler: () => {},
      initialValues: formSchema ? (current as any) : undefined,
    },
    [formSchema, atom.name],
  );

  useEffect(() => {
    setJsonText(JSON.stringify(current, null, 2));
    setJsonError(null);
    setStatus(null);
    setJsonMode(!formSchema);
  }, [atom.name, formSchema, current]);

  const save = useCallback(
    async (value: unknown) => {
      setStatus(null);
      try {
        const res = await http.fetch("/__devtools/api/atoms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: atom.name, value }),
        });
        const data = res.data as any;
        setStatus(data?.success ? "Saved" : (data?.message ?? "Rejected"));
        if (data?.success) props.onSaved();
      } catch (e: any) {
        setStatus(e?.message ?? "Failed to save");
      }
    },
    [http, atom.name, props],
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 14px 8px",
        }}
      >
        <span className="dt-mono" style={{ fontSize: 14 }}>
          {atom.name}
        </span>
        {atom.serverOnly ? (
          <span className="dt-chip">server-only</span>
        ) : (
          atom.currentValue !== undefined && (
            <span className="dt-chip" data-tone="accent">
              set
            </span>
          )
        )}
      </div>

      {atom.description && (
        <div
          style={{
            padding: "0 14px 12px",
            fontSize: 12,
            color: "var(--dt-fg-dim)",
          }}
        >
          {atom.description}
        </div>
      )}

      {atom.serverOnly ? (
        <>
          <div className="dt-section-label">Value</div>
          <div
            style={{
              padding: 14,
              fontSize: 11,
              color: "var(--dt-fg-faint)",
              fontStyle: "italic",
            }}
          >
            Hidden. This atom is declared `serverOnly`, so its value is never
            sent to the browser — only its name, description and schema are.
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dt-section-label">Current</div>
              <pre className="dt-pre">
                {atom.currentValue === undefined
                  ? "(using default)"
                  : JSON.stringify(atom.currentValue, null, 2)}
              </pre>
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                borderLeft: "1px solid var(--dt-border-soft)",
              }}
            >
              <div className="dt-section-label">Default</div>
              <pre className="dt-pre">
                {atom.defaultValue === undefined
                  ? "(no default)"
                  : JSON.stringify(atom.defaultValue, null, 2)}
              </pre>
            </div>
          </div>

          <div className="dt-section-label">
            Edit
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {formSchema && (
                <button
                  type="button"
                  className="dt-btn"
                  data-on={jsonMode || undefined}
                  onClick={() => setJsonMode(!jsonMode)}
                >
                  JSON
                </button>
              )}
              <button
                type="button"
                className="dt-btn"
                onClick={() => {
                  setJsonText(JSON.stringify(atom.defaultValue, null, 2));
                  setJsonError(null);
                }}
                title="Restore the declared default"
              >
                <RotateCcw size={11} /> Reset
              </button>
              <button
                type="button"
                className="dt-btn"
                data-on="true"
                disabled={jsonMode && !!jsonError}
                onClick={() => {
                  if (jsonMode) {
                    try {
                      save(JSON.parse(jsonText));
                    } catch {
                      setJsonError("Invalid JSON");
                    }
                  } else {
                    save(form.currentValues);
                  }
                }}
              >
                <Save size={11} /> Save
              </button>
            </span>
          </div>

          <div style={{ padding: 12 }}>
            {jsonMode || !formSchema ? (
              <>
                <textarea
                  className="dt-input dt-mono"
                  style={{ height: 150, padding: 8, resize: "vertical" }}
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.currentTarget.value);
                    try {
                      JSON.parse(e.currentTarget.value);
                      setJsonError(null);
                    } catch {
                      setJsonError("Invalid JSON");
                    }
                  }}
                />
                {jsonError && (
                  <div style={{ fontSize: 11, color: "var(--dt-error)" }}>
                    {jsonError}
                  </div>
                )}
              </>
            ) : (
              <div className="dt-form">
                <AutoForm form={form} noSubmit />
              </div>
            )}
            {status && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color:
                    status === "Saved" ? "var(--dt-get)" : "var(--dt-error)",
                }}
              >
                {status}
              </div>
            )}
          </div>
        </>
      )}

      <SchemaTree schema={atom.schema} label="Schema" rootName="value" />
      <AtomMutations atomName={atom.name} />
    </div>
  );
};
