import { type Infer, z } from "alepha";
import { audits } from "alepha/api/audits";

/**
 * One line of Home's Recent activity panel.
 *
 * The same rows as a project's Activity table, read across every project the
 * viewer belongs to instead of one. Picked from the `audits` entity rather
 * than restated, for the reason `projectActivityRowSchema` gives: a column
 * added there cannot silently diverge from what the panel shows.
 *
 * What it adds over that schema is {@link projectId} and {@link projectTitle},
 * because this feed spans projects: the panel names the project a line belongs
 * to, and hovering a row of the table beside it filters the panel down to that
 * project. What it drops is `metadata` and the burst span - the panel is one
 * line per event, not a table with a `title` on every cell.
 */
export const homeActivityRowSchema = audits.schema
  .pick({
    id: true,
    createdAt: true,
    type: true,
    action: true,
    userId: true,
    resourceType: true,
    /**
     * What the resource is ADDRESSED by - a quest's `shortId`, an epic's
     * `number`, a release's `tag`. Never a row id, which names no page.
     */
    resourceId: true,
    /**
     * The resource's title as it was at the time, so a rename after the fact
     * does not rewrite what the feed says happened.
     */
    description: true,
    eventCount: true,
  })
  .extend({
    /**
     * The project the event belongs to, from the row's `scopeId`.
     *
     * A number here, text on the row: `scopeId` is text so any scope can use
     * it, and every caller of this feed compares it against a project id.
     */
    projectId: z.integer(),
    /**
     * The project's title, so a line reads without a second lookup on the
     * client. Resolved by the controller against the viewer's memberships,
     * which it has already read to know which scopes to ask for.
     */
    projectTitle: z.text(),
    /**
     * The actor's display name, resolved by the controller. Absent when the
     * row carries no actor, or when the account has since been deleted.
     */
    actor: z.string().optional(),
    /**
     * Whether the actor is the viewer, so the panel can say "You" without
     * shipping the viewer's own id to the client to compare against.
     */
    isMe: z.boolean(),
  });

export type HomeActivityRow = Infer<typeof homeActivityRowSchema>;
