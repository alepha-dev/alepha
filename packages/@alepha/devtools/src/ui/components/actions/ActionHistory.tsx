import { useActionHistory } from "../../hooks/useActionHistory.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";

export interface ActionHistoryProps {
  actionKey: string;
  onRestore: (entry: {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
  }) => void;
}

const relative = (at: number): string => {
  const diff = Date.now() - at;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
};

export const ActionHistory = (props: ActionHistoryProps) => {
  const history = useActionHistory(props.actionKey);

  if (history.entries.length === 0) {
    return (
      <DevEmpty
        title="No requests yet"
        hint="Executions from the Try It tab are recorded here"
      />
    );
  }

  return (
    <div>
      <div className="dt-section-label">
        {history.entries.length} recorded
        <button
          type="button"
          className="dt-btn"
          style={{ marginLeft: "auto" }}
          onClick={history.clear}
        >
          Clear
        </button>
      </div>

      <table className="dt-table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>When</th>
            <th style={{ width: 70 }}>Status</th>
            <th style={{ width: 70 }}>Time</th>
            <th>Request</th>
            <th style={{ width: 80 }} />
          </tr>
        </thead>
        <tbody>
          {history.entries.map((e) => {
            const ok = !e.error && (e.status ?? 500) < 400;
            return (
              <tr key={e.at}>
                <td>{relative(e.at)}</td>
                <td
                  style={{
                    color: ok ? "var(--dt-get)" : "var(--dt-error)",
                  }}
                >
                  {e.error ? "failed" : e.status}
                </td>
                <td>{e.ms}ms</td>
                <td>
                  {e.error ??
                    JSON.stringify({
                      ...(e.params ?? {}),
                      ...(e.query ?? {}),
                      ...((e.body as any) ?? {}),
                    })}
                </td>
                <td>
                  <button
                    type="button"
                    className="dt-btn"
                    onClick={() =>
                      props.onRestore({
                        params: e.params,
                        query: e.query,
                        body: e.body,
                      })
                    }
                  >
                    Restore
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
