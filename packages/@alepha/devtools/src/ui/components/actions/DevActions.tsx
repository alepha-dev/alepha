import { z } from "alepha";
import { useQueryParams } from "alepha/react/router";
import { useMemo } from "react";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { ActionDetail } from "./ActionDetail.tsx";
import { ActionTree, actionKey } from "./ActionTree.tsx";

const querySchema = z.object({
  selected: z.text().optional(),
});

export const DevActions = () => {
  const meta = useMetadata();
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });

  const actions = meta.data?.actions ?? [];
  const selected = params.selected ?? "";

  const action = useMemo(
    () => actions.find((a) => actionKey(a) === selected),
    [actions, selected],
  );

  if (meta.error) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--dt-fg-dim)",
        }}
      >
        <span style={{ fontSize: 13 }}>Couldn’t load actions</span>
        <span
          className="dt-mono"
          style={{ fontSize: 11, color: "var(--dt-error)" }}
        >
          {meta.error}
        </span>
        <button type="button" className="dt-btn" onClick={meta.reload}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
      <ActionTree
        actions={actions}
        selected={selected}
        onSelect={(key) => setParams({ selected: key })}
      />

      {action ? (
        <ActionDetail action={action} />
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: "var(--dt-fg-faint)",
          }}
        >
          {meta.loading
            ? "Loading metadata…"
            : "Select an action from the rail"}
        </div>
      )}
    </div>
  );
};

export default DevActions;
