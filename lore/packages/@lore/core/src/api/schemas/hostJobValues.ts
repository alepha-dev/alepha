/*
 * Browser-loadable: the job pages list these, and a web file may not load
 * the service that declares the port (#Q3984).
 */

/**
 * The kinds of one-shot job a host runs. `agent` is Claude Code against a
 * fresh clone; `check` is the Agent host's capability check, Claude Code
 * asked to reply OK with nothing in reach.
 */
export const HOST_JOB_KINDS = ["agent", "check"] as const;

export type HostJobKind = (typeof HOST_JOB_KINDS)[number];

/**
 * `queued` (waiting for the host's one slot), `running`, then a terminal
 * status. `paused` is a job a provider's usage limit stopped, re-queued
 * after the limit's window.
 */
export const HOST_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export type HostJobStatus = (typeof HOST_JOB_STATUSES)[number];

export const HOST_JOB_TERMINAL: readonly HostJobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
];
