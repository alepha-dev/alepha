import { Button } from "@alepha/ui";
import type { HostCommandController, HostController } from "@lore/core/api";
import { type I18n, currentHostAtom } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRef, useState } from "react";

import BayAgentLimitsForm from "./BayAgentLimitsForm.tsx";

export interface BayAgentLimitsProps {
  /**
   * Whether the viewer may change the host (`host:update`), the gate of the
   * Check button.
   */
  canUpdate: boolean;
}

/**
 * An Agent host's two lane widths (#Q4543): how many jobs that change code
 * it runs at once, and how many others, as its Bay reports them, with an
 * edit for a member who may update the host.
 *
 * Saving sends the `jobs-limits` command, which Bay writes into its own
 * `jobs.json`, the file `bay config jobs` writes: Lore keeps no copy, so the
 * values shown are always the inventory's. The save stays pending until the
 * host answers and its inventory carries the new values, read through a
 * `useQuery` that pauses in a hidden tab; a refusal (out of range, a host
 * not connected, a Bay too old to know the verb) is said here, on the
 * control.
 */
const BayAgentLimits = (props: BayAgentLimitsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<HostController>();
  const commandApi = useClient<HostCommandController>();
  const [host, setHost] = useStore(currentHostAtom);
  const [editing, setEditing] = useState(false);
  const [following, setFollowing] = useState<
    | {
        commandId: string;
        wanted: { maxJobs?: number; maxReadJobs?: number };
        acked: boolean;
      }
    | undefined
  >();
  const [state, setState] = useState<
    | { kind: "pending" | "queued" | "reported" | "done" }
    | { kind: "failed"; reason: string }
    | undefined
  >();
  // How many reads the current save has taken, to stop following it.
  const reads = useRef(0);

  useQuery(
    {
      enabled: !!host && !!following,
      key: ["host-jobs-limits", host?.id, following?.commandId],
      runEvery: following ? POLL_MS : undefined,
      handler: async () => {
        if (!host || !following) return null;
        reads.current += 1;
        if (!following.acked) {
          const listed = await commandApi.listHostCommands({
            params: { hostId: host.id },
            query: { limit: 20 },
          });
          const command = listed.items.find(
            (item) => item.id === following.commandId,
          );
          if (command?.status === "failed") {
            setFollowing(undefined);
            setState({
              kind: "failed",
              reason: command.reason?.includes('unknown action "jobs-limits"')
                ? tr("hosts.agent.limits.oldBay")
                : (command.reason ?? ""),
            });
            return null;
          }
          if (command?.status === "done") {
            setFollowing({ ...following, acked: true });
          } else if (reads.current >= ATTEMPTS) {
            setFollowing(undefined);
            setState({ kind: "queued" });
          }
          return null;
        }
        // Acked: the values show once the inventory Bay pushed after it
        // has been read.
        const fresh = await api.getHost({ params: { hostId: host.id } });
        setHost({ ...fresh, projects: host.projects });
        const { wanted } = following;
        if (
          (wanted.maxJobs === undefined ||
            fresh.jobsMaxJobs === wanted.maxJobs) &&
          (wanted.maxReadJobs === undefined ||
            fresh.jobsMaxReadJobs === wanted.maxReadJobs)
        ) {
          setFollowing(undefined);
          setState({ kind: "done" });
          setEditing(false);
        } else if (reads.current >= ATTEMPTS) {
          setFollowing(undefined);
          setState({ kind: "reported" });
        }
        return null;
      },
      onError: () => {},
    },
    [host?.id, following],
  );

  if (!host) return null;
  const maxJobs = host.jobsMaxJobs ?? 1;
  const maxReadJobs = host.jobsMaxReadJobs ?? undefined;

  return (
    <div
      className="flex max-w-sm flex-col gap-1.5 text-xs"
      data-testid="bay-agent-limits"
    >
      {editing ? (
        <fieldset disabled={!!following} className="contents">
          <BayAgentLimitsForm
            hostId={host.id}
            maxJobs={maxJobs}
            {...(maxReadJobs !== undefined ? { maxReadJobs } : {})}
            onSent={(commandId, wanted) => {
              reads.current = 0;
              setState({ kind: "pending" });
              setFollowing({ commandId, wanted, acked: false });
            }}
            onRefused={(reason) => setState({ kind: "failed", reason })}
            onCancel={() => {
              setEditing(false);
              setState(undefined);
            }}
          />
        </fieldset>
      ) : (
        <>
          <span className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">
              {tr("hosts.agent.limits.maxJobs")}
            </span>
            <span
              className="font-medium tabular-nums"
              data-testid="bay-agent-limits-max-jobs-value"
            >
              {maxJobs}
            </span>
          </span>
          {maxReadJobs !== undefined && (
            <span className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">
                {tr("hosts.agent.limits.maxReadJobs")}
              </span>
              <span
                className="font-medium tabular-nums"
                data-testid="bay-agent-limits-max-read-jobs-value"
              >
                {maxReadJobs}
              </span>
            </span>
          )}
          {props.canUpdate && (
            <span>
              <Button
                size="sm"
                variant="outlined"
                onClick={() => {
                  setState(undefined);
                  setEditing(true);
                }}
                data-testid="bay-agent-limits-edit"
              >
                {tr("hosts.agent.limits.edit")}
              </Button>
            </span>
          )}
        </>
      )}
      {state && (
        <span
          className={
            state.kind === "failed" ? "text-danger" : "text-muted-foreground"
          }
          role={state.kind === "failed" ? "alert" : "status"}
          data-testid="bay-agent-limits-state"
          data-state={state.kind}
        >
          {state.kind === "failed"
            ? tr("hosts.agent.limits.failed", { args: [state.reason] })
            : tr(STATE_TEXT[state.kind])}
        </span>
      )}
    </div>
  );
};

/**
 * What each state of a save says.
 */
const STATE_TEXT = {
  pending: "hosts.agent.limits.pending",
  queued: "hosts.agent.limits.queued",
  reported: "hosts.agent.limits.reported",
  done: "hosts.agent.limits.done",
} as const;

/**
 * The gap between two reads of the queue or the host.
 */
const POLL_MS = 2000;
/**
 * How many reads a save follows: a minute, ample for one small file.
 */
const ATTEMPTS = 30;

export default BayAgentLimits;
