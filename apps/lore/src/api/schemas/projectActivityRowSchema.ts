import { type Infer, z } from "alepha";
import { audits } from "alepha/api/audits";

/**
 * One row of a project's Activity table.
 *
 * Picked from the `audits` entity rather than restated, so a column added
 * there cannot silently diverge from what this page shows. The one field that
 * is not a column is {@link actor}, which the controller resolves.
 *
 * ⚠️ What is deliberately NOT picked is as much of the design as what is:
 *
 * - `scopeType` / `scopeId` - the whole page is one project, so every row
 *   would carry the same two values.
 * - `ipAddress`, `userAgent`, `sessionId`, `requestId` - operator forensics,
 *   read on `/admin/audits` by somebody with the standing for it. This page is
 *   member-visible, and a member does not get their colleagues' IP addresses.
 * - `userEmail` - the row keeps it as a write-time snapshot, but the feed
 *   prints a display name. Shipping the address would leak every member's
 *   email to every other member through a page about quests.
 * - `severity` / `success` - nothing on the project layer writes a failure
 *   today (every call site is `logSuccess`), so both would render one constant.
 */
export const projectActivityRowSchema = audits.schema
  .pick({
    id: true,
    createdAt: true,
    /**
     * The resource kind - quest, epic, release, folio, feedback, member,
     * sigil, project. This is the page's "resource" filter.
     */
    type: true,
    /**
     * The verb. This is the page's "what" filter.
     */
    action: true,
    /**
     * Who did it. The page's "who" filter, and what {@link actor} names.
     */
    userId: true,
    resourceType: true,
    /**
     * The identifier the resource is ADDRESSED by, which is what lets a row
     * become a link: a quest's `shortId`, an epic's `number`, a release's
     * `tag`. Never a row id, which names no page.
     */
    resourceId: true,
    /**
     * The resource's title as it was at the time. A snapshot on purpose: a
     * quest renamed after the fact should not rewrite what the feed says
     * happened, and a deleted one still has to print as something.
     */
    description: true,
    metadata: true,
    /**
     * How many identical events this row stands for.
     *
     * Always at least 1. Above 1 the row is a burst that `$audit`'s
     * `coalesce` folded, and the table prints the count beside the verb -
     * `update x10` - rather than repeating the row ten times (#1872).
     */
    eventCount: true,
    /**
     * When the last event in the burst landed, so the row can name its own
     * span. Absent on a row that stands for one event, where `createdAt`
     * already says everything.
     */
    updatedAt: true,
  })
  .extend({
    /**
     * The actor's display name, resolved by the controller against the
     * project's members. The same value the quest page shows, so a name reads
     * identically in both places. Absent when the row carries no actor, or
     * when the account has since been deleted.
     */
    actor: z.string().optional(),
  });

export type ProjectActivityRow = Infer<typeof projectActivityRowSchema>;
