import type { Project } from "../../api/schemas/projectSchema.ts";
import type { ProjectState } from "../../api/schemas/projectStateSchema.ts";
import { OverviewRow } from "./OverviewRow.tsx";

export interface OverviewViewProps {
  project: Project;
  state?: ProjectState;
  error?: Error;
  onOpen: (path: string) => void;
  onRefresh: () => void;
}

/**
 * Every worktree of the project in one table, main first, newest after.
 *
 * The first column is headed with the base ref rather than a word, because
 * that is what its weave is measured against.
 */
export const OverviewView = (props: OverviewViewProps) => {
  const state = props.state;
  const worktrees = state?.worktrees ?? [];
  const working = worktrees.filter(
    (it) => it.claude.activity === "working",
  ).length;
  const stale = worktrees.filter((it) => it.claude.activity === "stale").length;
  const building = worktrees.filter(
    (it) => it.ci && it.ci.status !== "completed",
  ).length;
  const dirty = worktrees.filter(
    (it) =>
      it.status &&
      it.status.modified +
        it.status.staged +
        it.status.untracked +
        it.status.conflicted >
        0,
  ).length;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 pt-5 pb-4">
        <h1 className="text-[20px] font-semibold tracking-tight">
          {props.project.name}
        </h1>
        <span className="text-muted-foreground min-w-0 truncate font-mono text-[12px]">
          {props.project.path}
        </span>
        {state && (
          <span className="text-muted-foreground ml-auto text-[12px]">
            {worktrees.length} worktree{worktrees.length === 1 ? "" : "s"}
            {working > 0 && (
              <span className="text-weft"> · Claude working in {working}</span>
            )}
            {stale > 0 && (
              <span className="text-warn">
                {" "}
                · {stale} stale lock{stale === 1 ? "" : "s"}
              </span>
            )}
            {building > 0 && (
              <span className="text-weft"> · {building} in CI</span>
            )}
            {dirty > 0 && <span> · {dirty} with changes</span>}
          </span>
        )}
      </header>

      {props.error && !state && (
        <div className="text-fail px-6">
          Could not read {props.project.path}: {props.error.message}{" "}
          <button
            type="button"
            onClick={props.onRefresh}
            className="text-foreground underline"
          >
            Try again
          </button>
        </div>
      )}

      {!state && !props.error && (
        <p className="text-muted-foreground px-6">
          Reading worktrees, git status and CI...
        </p>
      )}

      {state && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1220px] table-fixed border-separate border-spacing-0 text-[12.5px]">
            {/*
             * Fixed widths for everything that has a natural size, and the
             * rest for the last commit, which truncates: a long subject must
             * not push the table past the editor's edge.
             */}
            <colgroup>
              <col className="w-[136px]" />
              <col className="w-[200px]" />
              <col className="w-[96px]" />
              <col className="w-[124px]" />
              <col className="w-[112px]" />
              <col className="w-[190px]" />
              <col className="w-[76px]" />
              <col className="w-[112px]" />
              <col />
            </colgroup>
            <thead className="bg-background sticky top-0 z-10">
              <tr className="text-muted-foreground text-left text-[11px] tracking-[0.04em]">
                <th className="border-border w-[140px] border-b py-1.5 pl-6 font-mono font-normal">
                  {state.base}
                </th>
                <th className="border-border border-b px-3 font-medium uppercase">
                  Worktree
                </th>
                <th className="border-border border-b px-3 font-medium uppercase">
                  Changes
                </th>
                <th className="border-border border-b px-3 font-medium uppercase">
                  CI
                </th>
                <th className="border-border border-b px-3 font-medium uppercase">
                  Lore
                </th>
                <th className="border-border border-b px-3 font-medium uppercase">
                  Claude
                </th>
                <th className="border-border border-b px-3 font-medium uppercase">
                  Serving
                </th>
                <th className="border-border border-b px-3 font-medium uppercase">
                  Created
                </th>
                <th className="border-border border-b px-3 pr-6 font-medium uppercase">
                  Last commit
                </th>
              </tr>
            </thead>
            <tbody>
              {worktrees.map((worktree) => (
                <OverviewRow
                  key={worktree.path}
                  worktree={worktree}
                  onOpen={() => props.onOpen(worktree.path)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
