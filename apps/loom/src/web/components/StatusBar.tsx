import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import {
  Asterisk,
  CircleCheck,
  CircleX,
  GitBranch,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import type { Project } from "../../api/schemas/projectSchema.ts";
import type { ProjectState } from "../../api/schemas/projectStateSchema.ts";

export interface StatusBarProps {
  project?: Project;
  state?: ProjectState;
  loading: boolean;
  error?: Error;
}

/**
 * The status bar, in warp: the one full-width band of Loom's colour, where
 * VS Code has its blue.
 *
 * Left is the project and its main branch's CI; right is how fresh the data
 * is and which sources could not answer, so an empty column elsewhere always
 * has its explanation here.
 */
export const StatusBar = (props: StatusBarProps) => {
  const state = props.state;
  const main = state?.worktrees.find((it) => it.isMain);
  const working =
    state?.worktrees.filter((it) => it.claude.activity === "working").length ??
    0;
  const ci = main?.ci;
  const ciLabel =
    ci?.status !== "completed"
      ? `${ci?.progress ?? 0}%`
      : ci.conclusion === "success"
        ? "passed"
        : ci.conclusion === "failure"
          ? "failed"
          : ci.conclusion;

  return (
    <footer className="bg-warp flex min-w-0 items-center gap-4 overflow-hidden px-2 text-[12px] whitespace-nowrap text-white">
      <span className="flex items-center gap-1">
        <GitBranch className="size-3.5" />
        {props.project?.name ?? "No project"}
        {state && <span className="opacity-75"> · {state.base}</span>}
      </span>

      {ci && (
        <a
          href={ci.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 hover:underline"
          title={`${ci.name} on ${main?.branch}`}
        >
          {ci.status !== "completed" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : ci.conclusion === "success" ? (
            <CircleCheck className="size-3.5" />
          ) : (
            <CircleX className="size-3.5" />
          )}
          {main?.branch} {ciLabel}
        </a>
      )}

      {working > 0 && (
        <span className="flex items-center gap-1">
          <Asterisk className="size-3.5" />
          Claude working in {working}
        </span>
      )}

      <span className="ml-auto" />

      {props.error && (
        <span className="bg-fail -my-1 flex h-[22px] items-center px-2">
          Refresh failed: {props.error.message}
        </span>
      )}
      {state && !state.sources.gh && (
        <span
          className="opacity-80"
          title="Loom reads CI through the GitHub CLI: install gh and run gh auth login."
        >
          CI unavailable
        </span>
      )}
      {state && !state.sources.lore && (
        <span
          className="opacity-80"
          title="Set LORE_API_KEY to show quest titles and epics."
        >
          Lore: numbers only
        </span>
      )}
      {state && (
        <span
          className="flex items-center gap-1 opacity-90"
          title={`Collected in ${state.took} ms`}
        >
          <RefreshCw
            className={props.loading ? "size-3 animate-spin" : "size-3"}
          />
          <TimeAgo value={state.collectedAt} />
        </span>
      )}
    </footer>
  );
};
