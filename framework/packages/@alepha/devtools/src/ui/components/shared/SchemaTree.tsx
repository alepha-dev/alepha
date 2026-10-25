import { useState } from "react";

import { SchemaTreeRow } from "./SchemaTreeRow.tsx";

export interface SchemaTreeProps {
  /**
   * A JSON Schema, as published by `DevToolsMetadataProvider`.
   */
  schema: any;
  label: string;
  /**
   * Extra text shown next to the section label — a content type, a status
   * code, whatever identifies this particular schema.
   */
  hint?: string;
  /**
   * Name given to the root node. Defaults to the lowercased label.
   */
  rootName?: string;
  openDepth?: number;
}

/**
 * Render a JSON Schema as an expandable tree.
 *
 * This replaces `JSON.stringify(schema, null, 2)` in a `<pre>`, which was how
 * every schema in devtools used to be presented — technically complete and
 * practically unreadable. A `{ }` toggle keeps the raw view one click away for
 * the cases where the tree hides something.
 */
export const SchemaTree = (props: SchemaTreeProps) => {
  const [raw, setRaw] = useState(false);

  if (!props.schema) {
    return null;
  }

  return (
    <div>
      <div className="dt-section-label">
        <span>{props.label}</span>
        {props.hint && (
          <span style={{ textTransform: "none", letterSpacing: 0 }}>
            {props.hint}
          </span>
        )}
        <button
          type="button"
          className="dt-schema-toggle"
          style={{ marginLeft: "auto", width: "auto" }}
          onClick={() => setRaw(!raw)}
          title={raw ? "Show tree" : "Show raw JSON Schema"}
        >
          {"{ }"}
        </button>
      </div>

      {raw ? (
        <pre className="dt-pre">{JSON.stringify(props.schema, null, 2)}</pre>
      ) : (
        <div style={{ padding: "4px 0" }}>
          <SchemaTreeRow
            name={props.rootName ?? props.label.toLowerCase()}
            schema={props.schema}
            required={false}
            depth={0}
            openDepth={props.openDepth ?? 2}
          />
        </div>
      )}
    </div>
  );
};
