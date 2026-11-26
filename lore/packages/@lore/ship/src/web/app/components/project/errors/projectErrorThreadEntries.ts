import type { ProjectErrorDetail } from "../../../../../api/schemas/projectErrorDetailSchema.ts";
import type { ProjectErrorEventKind } from "../../../../../api/schemas/projectErrorEventKindSchema.ts";
import type { ProjectErrorThreadEntry } from "../../../../../api/schemas/projectErrorThreadEntrySchema.ts";

/**
 * One line of an error's timeline, as the page draws it.
 *
 * Two of them are not stored: an error's first report is its `firstSeenAt`,
 * and a server error trusted on arrival has no trust event, since its trust
 * is as old as the error. Both are read from the row.
 */
export type ProjectErrorTimelineEntry =
  | {
      key: string;
      type: "event";
      kind: ProjectErrorEventKind | "first_reported" | "trusted_on_arrival";
      at: string;
      entry?: ProjectErrorThreadEntry;
    }
  | {
      key: string;
      type: "comment";
      at: string;
      entry: ProjectErrorThreadEntry;
    };

/**
 * The timeline of an error: what its thread holds, between the two entries
 * the row itself tells (first reported, trusted on arrival), oldest first.
 */
export const buildProjectErrorTimeline = (
  detail: ProjectErrorDetail,
  thread: ProjectErrorThreadEntry[],
): ProjectErrorTimelineEntry[] => {
  const { error } = detail;
  const head: ProjectErrorTimelineEntry[] = [
    {
      key: "first-reported",
      type: "event",
      kind: "first_reported",
      at: error.firstSeenAt,
    },
  ];
  // Trusted with nobody behind it, and no event saying a member did it: on
  // arrival. A member's later withdrawal and trust are events of their own.
  if (
    error.trustedAt &&
    !error.trustedBy &&
    !thread.some((entry) => entry.kind === "trusted")
  ) {
    head.push({
      key: "trusted-on-arrival",
      type: "event",
      kind: "trusted_on_arrival",
      at: error.trustedAt,
    });
  }
  return [
    ...head,
    ...thread.map((entry): ProjectErrorTimelineEntry =>
      entry.type === "comment"
        ? { key: `comment-${entry.id}`, type: "comment", at: entry.at, entry }
        : {
            key: `event-${entry.id}`,
            type: "event",
            kind: entry.kind ?? "resolved",
            at: entry.at,
            entry,
          },
    ),
  ];
};
