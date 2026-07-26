import { X } from "lucide-react";
import { useState } from "react";
import { type DevAuthValue, useDevAuth } from "../../hooks/useDevAuth.ts";

export interface AuthorizeSheetProps {
  onClose: () => void;
}

export const AuthorizeSheet = (props: AuthorizeSheetProps) => {
  const { auth, setAuth, clear } = useDevAuth();
  const [draft, setDraft] = useState<DevAuthValue>(auth);

  const headers = draft.headers ?? [];

  const setHeader = (index: number, key: string, value: string) => {
    const next = [...headers];
    next[index] = { key, value };
    setDraft({ ...draft, headers: next });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={props.onClose}
    >
      <div
        style={{
          width: 460,
          maxWidth: "92vw",
          background: "var(--dt-panel)",
          borderLeft: "1px solid var(--dt-border)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 14px",
            borderBottom: "1px solid var(--dt-border)",
          }}
        >
          <span style={{ fontSize: 13 }}>Authorize</span>
          <button
            type="button"
            className="dt-btn"
            style={{ marginLeft: "auto", padding: "0 6px" }}
            onClick={props.onClose}
          >
            <X size={12} />
          </button>
        </div>

        <div style={{ padding: 14, overflowY: "auto", flex: 1 }}>
          <p
            style={{
              margin: "0 0 14px",
              fontSize: 11,
              lineHeight: 1.6,
              color: "var(--dt-fg-faint)",
            }}
          >
            Applied to every Try It request. Stored in this browser only — it is
            never sent anywhere except the application you are inspecting.
          </p>

          <div className="dt-section-label" style={{ margin: "0 -14px 8px" }}>
            Bearer token
          </div>
          <textarea
            className="dt-input dt-mono"
            style={{ height: 90, padding: 8, resize: "vertical" }}
            placeholder="eyJhbGciOi…"
            value={draft.bearer ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, bearer: e.currentTarget.value })
            }
          />

          <div
            className="dt-section-label"
            style={{ margin: "16px -14px 8px" }}
          >
            Custom headers
          </div>
          {headers.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input
                className="dt-input dt-mono"
                placeholder="X-Header"
                value={h.key}
                onChange={(e) => setHeader(i, e.currentTarget.value, h.value)}
              />
              <input
                className="dt-input dt-mono"
                placeholder="value"
                value={h.value}
                onChange={(e) => setHeader(i, h.key, e.currentTarget.value)}
              />
              <button
                type="button"
                className="dt-btn"
                onClick={() =>
                  setDraft({
                    ...draft,
                    headers: headers.filter((_, j) => j !== i),
                  })
                }
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="dt-btn"
            onClick={() =>
              setDraft({
                ...draft,
                headers: [...headers, { key: "", value: "" }],
              })
            }
          >
            Add header
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            padding: 14,
            borderTop: "1px solid var(--dt-border)",
          }}
        >
          <button
            type="button"
            className="dt-btn"
            data-on="true"
            onClick={() => {
              setAuth(draft);
              props.onClose();
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="dt-btn"
            onClick={() => {
              clear();
              setDraft({});
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};
