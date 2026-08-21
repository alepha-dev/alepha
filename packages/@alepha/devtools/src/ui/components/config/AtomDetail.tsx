import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { jsonSchemaToZod, z } from "alepha";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { HttpClient } from "alepha/server";
import { RotateCcw, Save } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { DevAtomMetadata } from "../../../schemas/DevAtomMetadata.ts";
import { SchemaTree } from "../shared/SchemaTree.tsx";
import { AtomChannels } from "./AtomChannels.tsx";
import { AtomMutations } from "./AtomMutations.tsx";
import { collapse } from "./collapseValue.ts";

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
    if (!atom.schema) return null;
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

  // Re-seeded during render, not from an effect: otherwise the editor paints
  // the previously selected atom's JSON for a frame before correcting itself.
  const seed = { name: atom.name, formSchema, current };
  const [seededFrom, setSeededFrom] = useState(seed);
  if (
    seededFrom.name !== seed.name ||
    seededFrom.formSchema !== seed.formSchema ||
    seededFrom.current !== seed.current
  ) {
    setSeededFrom(seed);
    setJsonText(JSON.stringify(current, null, 2));
    setJsonError(null);
    setStatus(null);
    setJsonMode(!formSchema);
  }

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
        {/*
         * Independent facts, so both can show: `server-only` is where the
         * value can travel, `set` is whether anything has written it.
         */}
        {atom.serverOnly && (
          <span className="dt-chip" title="Not hydrated into the browser">
            server-only
          </span>
        )}
        {atom.currentValue !== undefined && (
          <span className="dt-chip" data-tone="accent">
            set
          </span>
        )}
        {atom.persist && (
          <span className="dt-chip" data-tone="accent">
            {atom.persist}
          </span>
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

      {/*
       * `serverOnly` atoms render exactly like any other. The flag says the
       * application does not hydrate the value into the browser; it does not
       * say a developer inspecting their own server may not read it — and this
       * screen is the only place that state is visible at all.
       */}
      <div style={{ display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dt-section-label">Current value</div>
          <div style={{ padding: "10px 14px" }}>
            <div className="dt-mono dt-atom-value">
              {atom.currentValue === undefined
                ? "(using default)"
                : collapse(atom.currentValue)}
            </div>
            <div className="dt-atom-value-sub">live value in the store</div>
          </div>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            borderLeft: "1px solid var(--dt-border-soft)",
          }}
        >
          <div className="dt-section-label">Default value</div>
          <div style={{ padding: "10px 14px" }}>
            <div className="dt-mono dt-atom-value">
              {atom.defaultValue === undefined
                ? "(no default)"
                : collapse(atom.defaultValue)}
            </div>
            <div className="dt-atom-value-sub">declared on the atom</div>
          </div>
        </div>
      </div>

      <div className="dt-section-label">
        Edit · server store
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
              // Reset has to reach whichever editor is showing — resetting
              // only the JSON textarea leaves the form untouched, so the
              // button looks broken half the time.
              setJsonText(JSON.stringify(atom.defaultValue, null, 2));
              setJsonError(null);
              if (!jsonMode && formSchema) {
                form.setInitialValues((atom.defaultValue ?? {}) as any);
              }
            }}
            title="Restore the declared default"
          >
            <RotateCcw size={11} /> Reset
          </button>
          <button
            type="button"
            className="dt-btn"
            data-variant="primary"
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
            {/*
             * The section header already owns Reset and Save, so AutoForm's
             * bottom bar would put a second Reset on screen.
             */}
            <AutoForm form={form} noSubmit skipBottomBar />
          </div>
        )}
        {status && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: status === "Saved" ? "var(--dt-get)" : "var(--dt-error)",
            }}
          >
            {status}
          </div>
        )}
      </div>

      <AtomChannels atom={atom} />

      <SchemaTree schema={atom.schema} label="Schema" rootName="value" />
      <AtomMutations atomName={atom.name} />
    </div>
  );
};
