import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@alepha/ui";
import type { InspectorRun } from "alepha/inspector";
import { ChevronDown } from "lucide-react";

import { useRelativeTime } from "../../hooks/useRelativeTime.ts";

export interface RunSwitcherProps {
  runs: InspectorRun[];
  current?: InspectorRun;
  onSelect: (run: InspectorRun) => void;
}

/**
 * The app being inspected, and every other one to switch to: live runs
 * first, then the dead ones whose logs are still readable.
 */
export const RunSwitcher = (props: RunSwitcherProps) => {
  const ago = useRelativeTime({ fallback: "unknown" });
  const label = props.current
    ? `${props.current.name}${props.current.status === "dead" ? " (stopped)" : ""}`
    : "No app";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="dt-btn" title={props.current?.cwd}>
        {label}
        <ChevronDown size={11} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {/* A label is a group's label: Base UI refuses one outside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Running apps</DropdownMenuLabel>
          {props.runs.map((run) => (
            <DropdownMenuItem
              key={run.runId}
              onClick={() => props.onSelect(run)}
              title={run.cwd}
            >
              <span style={{ fontWeight: run === props.current ? 600 : 400 }}>
                {run.name}
              </span>
              <span style={{ opacity: 0.6, marginLeft: 8 }}>
                {run.status === "dead" ? "stopped" : run.mode},{" "}
                {ago(run.startedAt)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
