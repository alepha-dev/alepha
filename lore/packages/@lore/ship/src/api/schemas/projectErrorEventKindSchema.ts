import { type Infer, z } from "alepha";

/**
 * What changed an error's triage state (#E185): one entry of its thread per
 * change, whoever or whatever made it.
 *
 * By a member (the event carries an actor):
 * - `trusted`, `untrusted`: an agent may read the error from now on, or no
 *   longer may;
 * - `resolved`;
 * - `forwarded`: to a quest created for it;
 * - `linked`: to a quest already filed.
 *
 * By Lore itself (no actor):
 * - `handed_back`: its quest was deleted, the error is open again;
 * - `run_resolved`, `run_reopened`: a passing run of its use case resolved
 *   it, the next failing run reopened it;
 * - `monitor_resolved`, `monitor_reopened`: its monitor recovered, then went
 *   down again.
 *
 * A server error trusted on arrival has no event: its trust is as old as
 * the error. Nothing here is written on the ingest path.
 */
export const projectErrorEventKindSchema = z.enum([
  "trusted",
  "untrusted",
  "resolved",
  "forwarded",
  "linked",
  "handed_back",
  "run_resolved",
  "run_reopened",
  "monitor_resolved",
  "monitor_reopened",
]);

export type ProjectErrorEventKind = Infer<typeof projectErrorEventKindSchema>;
