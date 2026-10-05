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
 * deploy, and the UI confirms destructively before sending it.
 *
 * The machine's own `actionKind` in Bay's `cmd/bay/actions.go` is the other
 * half of this enum, and neither may grow without the other.
 */
export const ESTATE_COMMAND_KINDS = [
  "restart",
  "deploy",
  "stop",
  "start",
  "backup",
  "logs",
] as const;

export type EstateCommandKind = (typeof ESTATE_COMMAND_KINDS)[number];

/**
 * `pending` (queued, the machine was offline or the push failed), `sent`
 * (pushed over the open connection), `running` (the machine acknowledged
 * pickup), then `done` or `failed`.
 */
export const ESTATE_COMMAND_STATUSES = [
  "pending",
  "sent",
  "running",
  "done",
  "failed",
] as const;

export type EstateCommandStatus = (typeof ESTATE_COMMAND_STATUSES)[number];
