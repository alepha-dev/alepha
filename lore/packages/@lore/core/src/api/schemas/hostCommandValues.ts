/*
 * Browser-loadable (#E75, #Q2624): the Bay commands page lists these, and
 * a web file may not load the entity that stores them.
 */

/**
 * The closed action vocabulary, in full.
 *
 * ⚠️ Every action is a named variant with typed fields, and nothing takes a
 * free-form path, shell command or argument list. That is the security
 * boundary of the whole connector (folio #64's objection, answered by folio
 * #1152): the capability ceiling is this set, not the channel. `deploy` is
 * already code execution as the app user, so the set bounds the blast radius
 * without making it small, and it is not a list to extend casually.
 *
 * ⚠️ `stop` is the first verb here that can make a live site go dark from a
 * click in a browser: everything before it either replaced a running app with
 * another running app or asked a question. It is durable on the machine (the
 * intent is persisted and the unit disabled), so the way back is `start` or a
 * deploy, and the UI confirms destructively before sending it. `remove`
 * goes one step further, unregistering the copy, and keeps its data for the
 * same reason: a deploy brings it back.
 *
 * The machine's own `actionKind` in Bay's `cmd/bay/actions.go` is the other
 * half of this enum, and neither may grow without the other.
 */
export const HOST_COMMAND_KINDS = [
  "restart",
  "deploy",
  "stop",
  "start",
  "backup",
  "logs",
  // Apply a stack revision to a stack environment (#E79): the bundle by
  // digest, the environment's routes and base domain. Held to the same
  // deploy switch as `deploy`. Bay's `actionStackDeploy` is its other half.
  "stack-deploy",
  // Backups (Bay's `cmd/bay/backupactions.go`). `backups-list`,
  // `backup-verify` and `target-probe` only read, and answer through the
  // result route; `backup-policy` sets the operator layer of an instance's
  // policy and `restore` replaces its databases, so both are held to the
  // deploy switch (a dry-run restore only reads, and is not).
  "backups-list",
  "backup-verify",
  "target-probe",
  "backup-policy",
  "restore",
  // Undeploying (#Q3153, folio #F1455): `remove` unregisters one instance
  // and `stack-remove` takes a stack environment down, both keeping their
  // data on the machine, both held to the deploy switch. ⚠️ Neither has a
  // purge, and none may be added: deleting a copy's data is the one thing no
  // backup undoes, so it stays `bay remove --purge` run on the machine.
  // Bay's `actionRemove` and `actionStackRemove` are their other half.
  "remove",
  "stack-remove",
  // Replace Bay's own binary with a released version and hand over to it
  // (#E152). ⚠️ The most powerful verb here: the binary runs as root. What
  // bounds it: the payload is a strict `x.y.z` and nothing else (no URL, no
  // path, no checksum comes from Lore); Bay refuses any version older than
  // its own, so there is no downgrade on the wire; it is held to the deploy
  // switch on both sides; and a host that cannot hand its sockets over
  // refuses it. Bay's `actionUpgrade` is its other half.
  "upgrade",
  // One-shot jobs (#Q3983, folio #F1500 decision 9): `job-run` carries
  // nothing but its id, and the machine PULLS the job's structured spec by
  // that id and validates it; Bay builds the command line itself, so no
  // shell command or argument list ever travels. `job-cancel` names the run
  // it stops (`jobCommandId`). Held to the host's own `jobsAllowed` switch,
  // never to `deployAllowed`, and never under the machine mutex deploys
  // serialise on. Bay's `actionJobRun` and `actionJobCancel` are their other
  // half.
  "job-run",
  "job-cancel",
  // A member's message to a running agent job (#Q4456): `jobCommandId` and
  // `message`, nothing else. Bay writes it to the job's stdin, on an agent
  // that reads messages while it runs, and refuses it for any other. Bay's
  // `actionJobMessage` is its other half.
  "job-message",
  // Deletes a project's job workspace on the machine, or all of them
  // (#Q4218): `project` and an optional `workspace`, nothing else. Asked when
  // a project is deleted or a quest's build is done with. Held to no switch:
  // it frees disk and touches no app. Bay's `actionJobWorkspaceRemove`.
  "job-workspace-remove",
  // Sets the host's two lane widths in Bay's own `jobs.json` (#Q4543):
  // `maxJobs` and/or `maxReadJobs`, each 1 to HOST_JOBS_LIMIT_CEILING, the
  // bounds of `bay config jobs`. Lore keeps no copy: the inventory that
  // follows is what the host page reads. Held to no switch: it runs
  // nothing. Bay's `actionJobsLimits` is its other half.
  "jobs-limits",
] as const;

/**
 * The most jobs of one lane a host runs at once: Bay's `maxJobsCeiling`,
 * the bound of `bay config jobs --max-jobs` and `--max-read-jobs` (#Q4543).
 */
export const HOST_JOBS_LIMIT_CEILING = 16;

export type HostCommandKind = (typeof HOST_COMMAND_KINDS)[number];

/**
 * `pending` (queued, the machine was offline or the push failed), `sent`
 * (pushed over the open connection), `running` (the machine acknowledged
 * pickup), then `done` or `failed`.
 */
export const HOST_COMMAND_STATUSES = [
  "pending",
  "sent",
  "running",
  "done",
  "failed",
] as const;

export type HostCommandStatus = (typeof HOST_COMMAND_STATUSES)[number];
