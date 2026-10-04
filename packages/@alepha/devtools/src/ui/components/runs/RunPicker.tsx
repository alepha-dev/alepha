import { useRouter } from "alepha/react/router";
import { Zap } from "lucide-react";
import { useEffect } from "react";

import { useRelativeTime } from "../../hooks/useRelativeTime.ts";
import { useRuns } from "../../hooks/useRuns.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";

/**
 * Every app running on this machine, to pick one. With exactly one live app
 * and nothing else to choose, it opens that one straight away.
 */
const RunPicker = () => {
  const router = useRouter();
  const { runs, loaded, error } = useRuns();
  const ago = useRelativeTime({ fallback: "unknown" });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  }, []);

  useEffect(() => {
    if (runs.length === 1 && runs[0].status === "live") {
      void router.push(`/apps/${encodeURIComponent(runs[0].runId)}`);
    }
  }, [runs, router]);

  return (
    <div className="dt-root">
      <div className="dt-topbar">
        <div className="dt-brand">
          <span className="dt-brand-mark">
            <Zap size={12} />
          </span>
          <span>
            <strong>Alepha</strong>{" "}
            <span style={{ color: "var(--dt-fg-dim)" }}>DevTools</span>
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {error && <DevError what="the running apps" message={error} />}
        {loaded && !error && runs.length === 0 && (
          <DevEmpty
            title="No app is running"
            hint="Start one with `alepha dev`, or a build made with `alepha build --inspect` and run with ALEPHA_INSPECT=1. It shows up here on its own."
          />
        )}
        {runs.length > 0 && (
          <table className="dt-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Started</th>
                <th>Directory</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.runId}
                  className="dt-row-click"
                  onClick={() =>
                    router.push(`/apps/${encodeURIComponent(run.runId)}`)
                  }
                >
                  <td style={{ color: "var(--dt-fg)" }}>{run.name}</td>
                  <td>{run.status}</td>
                  <td>{run.mode}</td>
                  <td>{ago(run.startedAt)}</td>
                  <td title={run.cwd}>{run.cwd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default RunPicker;
