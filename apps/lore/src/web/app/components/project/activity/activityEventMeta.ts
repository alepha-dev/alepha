import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CircleCheck,
  CirclePlus,
  Flag,
  Inbox,
  Layers,
  MessageCircle,
  PauseCircle,
  Pencil,
  Signature,
  UserMinus,
} from "lucide-react";

import type { ProjectActivityEvent } from "@/api/schemas/projectActivitySchema.ts";

export type ActivityKind = ProjectActivityEvent["kind"];

/**
 * The four groups the page's filter bar offers.
 *
 * A group rather than one chip per kind: there are thirteen kinds and seven
 * of them are quest lifecycle, so a chip each would be a wall of controls
 * over a list that is usually a dozen rows. The groups match the sidebar's
 * vocabulary, which is the vocabulary the reader already has.
 */
export type ActivityFilter = "quests" | "epics" | "folios" | "feedback";

export const ACTIVITY_FILTERS: ActivityFilter[] = [
  "quests",
  "epics",
  "folios",
  "feedback",
];

/**
 * Which chip each kind answers to.
 *
 * Releases are grouped under `epics` rather than given a fifth chip: both
 * answer "what is being shipped", and a release moves a handful of times a
 * month. A chip that is empty on most days teaches the reader nothing.
 *
 * `feedback.created` is alone in its group because arrivals are the only
 * feedback event there is - the table carries no update stamp, so a triage
 * decision leaves nothing for the feed to find.
 */
export const ACTIVITY_GROUP: Record<ActivityKind, ActivityFilter> = {
  "quest.created": "quests",
  "quest.updated": "quests",
  "quest.accepted": "quests",
  "quest.unassigned": "quests",
  "quest.completed": "quests",
  "quest.shelved": "quests",
  "quest.commented": "quests",
  "feedback.created": "feedback",
  "folio.updated": "folios",
  "epic.created": "epics",
  "epic.updated": "epics",
  "release.created": "epics",
  "release.published": "epics",
};

export const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  "quest.created": CirclePlus,
  "quest.updated": Pencil,
  // The same glyph the quest page uses for "took the quest", so a reader
  // who has seen one has seen the other.
  "quest.accepted": Signature,
  "quest.unassigned": UserMinus,
  "quest.completed": CircleCheck,
  "quest.shelved": PauseCircle,
  "quest.commented": MessageCircle,
  "feedback.created": Inbox,
  "folio.updated": BookOpen,
  "epic.created": Layers,
  "epic.updated": Layers,
  "release.created": Flag,
  "release.published": Flag,
};

/**
 * The windows the page offers, in hours.
 *
 * 30 days is the ceiling because the service clamps there
 * (`ProjectActivityService.maxWindowDays`) and reports the clamp as
 * `sinceClamped`; offering a longer one would be offering a lie.
 */
// Spelled as literals, not `24 * 7`: `as const` does not fold arithmetic, so
// a computed entry widens to `number` and takes the label lookup below with
// it.
export const ACTIVITY_WINDOWS = [3, 24, 168, 720] as const;

export type ActivityWindow = (typeof ACTIVITY_WINDOWS)[number];

/**
 * Literal label keys for both controls.
 *
 * `as const` rather than a template literal at the call site: `tr()` is typed
 * against the `en` dictionary's key union, and a computed key widens to
 * `string`, which silently turns every one of these into an unchecked lookup
 * that renders the key itself when it is wrong.
 */
export const ACTIVITY_WINDOW_LABELS = {
  3: "activity.window.3h",
  24: "activity.window.24h",
  168: "activity.window.7d",
  720: "activity.window.30d",
} as const;

export const ACTIVITY_FILTER_LABELS = {
  quests: "activity.filter.quests",
  epics: "activity.filter.epics",
  folios: "activity.filter.folios",
  feedback: "activity.filter.feedback",
} as const;
