import type { InspectorRun } from "alepha/inspector";
import { useRouter } from "alepha/react/router";
import { GitBranch, Zap } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useRelativeTime } from "../../hooks/useRelativeTime.ts";
import { useRuns } from "../../hooks/useRuns.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";

/**
 * Every app running on this machine, to pick one, grouped by repository and
 * then by worktree, each with its branch and how far it is from its upstream.
 * With exactly one live app and nothing else to choose, it opens that one
 * straight away.
 */
const RunPicker = () => {
  const router = useRouter();
  const { runs, worktrees, loaded, error } = useRuns();
  const ago = useRelativeTime({ fallback: "unknown" });

  /**
   * Repository, then worktree, then runs. A run outside any repository gets a
   * group of its own; one whose worktree has not been read yet stands in its
   * own root until the next refresh places it.
   */
  const groups = useMemo(() => {
    const byRepo = new Map<string, Map<string, InspectorRun[]>>();
    for (const run of runs) {
      const state = run.gitRoot ? worktrees[run.gitRoot] : undefined;
      const repo = state?.repository ?? run.gitRoot ?? "";
      const tree = run.gitRoot ?? "";
      const trees = byRepo.get(repo) ?? new Map<string, InspectorRun[]>();
      trees.set(tree, [...(trees.get(tree) ?? []), run]);
      byRepo.set(repo, trees);
    }
    return [...byRepo.entries()].map(([repo, trees]) => ({
      repo,
      trees: [...trees.entries()].map(([tree, list]) => ({
        tree,
        state: tree ? worktrees[tree] : undefined,
        runs: list,
      })),
    }));
  }, [runs, worktrees]);

  const base = (path: string) => path.split(/[\\/]/).pop() || path;

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
        {groups.map((group) => (
          <div key={group.repo || "none"} style={{ marginBottom: 16 }}>
            <div className="dt-section-label" title={group.repo}>
              {group.repo ? base(group.repo) : "Outside a repository"}
            </div>
            {group.trees.map((tree) => (
              <div key={tree.tree || "none"}>
                {tree.tree && (
                  <div
                    className="dt-section-sub"
                    title={tree.tree}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      padding: "8px 14px 4px",
                      fontSize: 11,
                      color: "var(--dt-fg-dim)",
                    }}
                  >
                    <GitBranch size={11} />
                    <span>{tree.state?.branch ?? "…"}</span>
                    {tree.tree !== group.repo && (
                      <span style={{ opacity: 0.6 }}>{base(tree.tree)}</span>
                    )}
                    {tree.state?.ahead !== undefined && (
                      <span title="ahead / behind its upstream">
                        ↑{tree.state.ahead} ↓{tree.state.behind}
                      </span>
                    )}
                    {tree.state !== undefined && (
                      <span>
                        {tree.state.dirty === 0
                          ? "clean"
                          : `${tree.state.dirty} changed`}
                      </span>
                    )}
                  </div>
                )}
                <table className="dt-table">
                  <tbody>
                    {tree.runs.map((run) => (
                      <tr
                        key={run.runId}
                        className="dt-row-click"
                        onClick={() =>
                          router.push(`/apps/${encodeURIComponent(run.runId)}`)
                        }
                      >
                        <td style={{ color: "var(--dt-fg)", width: 220 }}>
                          {run.name}
                        </td>
                        <td style={{ width: 70 }}>{run.status}</td>
                        <td style={{ width: 110 }}>{run.mode}</td>
                        <td style={{ width: 140 }}>{ago(run.startedAt)}</td>
                        <td title={run.cwd}>{run.cwd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default RunPicker;
