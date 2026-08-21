import { useCallback, useState } from "react";

import type { DevActionMetadata } from "../../../schemas/DevActionMetadata.ts";
import { useActionHistory } from "../../hooks/useActionHistory.ts";
import { METHOD_COLOR } from "../shared/methodColor.ts";
import { SchemaTree } from "../shared/SchemaTree.tsx";
import { ActionHistory } from "./ActionHistory.tsx";
import { ActionTryIt } from "./ActionTryIt.tsx";

export interface ActionDetailProps {
  action: DevActionMetadata;
}

export const ActionDetail = (props: ActionDetailProps) => {
  const action = props.action;
  const [tab, setTab] = useState<"schema" | "tryit" | "history">("schema");
  const [copied, setCopied] = useState(false);
  const actionKey = `${action.method}:${action.fullPath}`;
  const history = useActionHistory(actionKey);

  const copyCurl = useCallback(() => {
    const lines = [`curl -X ${action.method.toUpperCase()} \\`];
    if (action.body) {
      lines.push(`  -H 'Content-Type: application/json' \\`);
      lines.push(`  -d '{}' \\`);
    }
    lines.push(`  'http://localhost${action.fullPath}'`);
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [action]);

  const hasSchema =
    action.body || action.params || action.query || action.response;

  return (
    <div className="dt-detail">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 14px 8px",
        }}
      >
        <span
          className="dt-chip"
          style={{
            color: METHOD_COLOR[action.method.toUpperCase()],
            borderColor: "var(--dt-border)",
          }}
        >
          {action.method.toUpperCase()}
        </span>
        <span className="dt-mono" style={{ fontSize: 14 }}>
          {action.fullPath}
        </span>
        {action.secure && (
          <span className="dt-chip" data-tone="accent">
            secure
          </span>
        )}
        <button
          type="button"
          className="dt-btn"
          style={{ marginLeft: "auto" }}
          onClick={copyCurl}
        >
          {copied ? "copied" : "cURL"}
        </button>
      </div>

      {action.description && (
        <div
          style={{
            padding: "0 14px 10px",
            fontSize: 12,
            color: "var(--dt-fg-dim)",
          }}
        >
          {action.description}
        </div>
      )}

      {action.middlewares && action.middlewares.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            padding: "0 14px 12px",
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--dt-fg-faint)",
              marginRight: 4,
            }}
          >
            Middleware
          </span>
          {action.middlewares.map((mw: any) => (
            <span key={mw.name} className="dt-chip">
              {mw.name}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          borderBottom: "1px solid var(--dt-border)",
        }}
      >
        <button
          type="button"
          className="dt-tab"
          data-active={tab === "schema" || undefined}
          onClick={() => setTab("schema")}
        >
          Schema
        </button>
        <button
          type="button"
          className="dt-tab"
          data-active={tab === "tryit" || undefined}
          onClick={() => setTab("tryit")}
        >
          Try It
        </button>
        <button
          type="button"
          className="dt-tab"
          data-active={tab === "history" || undefined}
          onClick={() => setTab("history")}
        >
          History
          {history.entries.length > 0 && (
            <span className="dt-nav-count" style={{ marginLeft: 6 }}>
              {history.entries.length}
            </span>
          )}
        </button>
      </div>

      {tab === "schema" &&
        (hasSchema ? (
          <div>
            <SchemaTree
              schema={action.params}
              label="Path parameters"
              rootName="params"
            />
            <SchemaTree
              schema={action.query}
              label="Query parameters"
              rootName="query"
            />
            <SchemaTree
              schema={action.body}
              label="Request body"
              rootName="body"
              hint={action.bodyContentType}
            />
            <SchemaTree
              schema={action.response}
              label="Response"
              rootName="response"
            />
          </div>
        ) : (
          <div
            style={{
              padding: 24,
              fontSize: 12,
              color: "var(--dt-fg-faint)",
              textAlign: "center",
            }}
          >
            This action declares no schema.
          </div>
        ))}

      {tab === "tryit" && <ActionTryIt action={action} />}

      {tab === "history" && (
        <ActionHistory
          actionKey={actionKey}
          onRestore={() => setTab("tryit")}
        />
      )}
    </div>
  );
};
