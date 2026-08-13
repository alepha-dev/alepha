import { type Infer, z } from "alepha";

/**
 * One row of the instance-wide projects list in the admin shell.
 *
 * Deliberately thin. This view answers "what projects exist on this instance,
 * who owns them, and how busy are they" — it is not a second project detail
 * page. Every project-scoped read elsewhere stays member-gated, and nothing
 * here exposes a project's contents.
 */
export const adminProjectResourceSchema = z.object({
  id: z.integer(),
  title: z.string(),
  createdBy: z.uuid(),
  /**
   * Display name for `createdBy`, resolved for the page being displayed only.
   *
   * Optional because `projects.createdBy` carries no foreign key to `users` —
   * an account removed from the realm leaves a project row pointing at an id
   * that no longer resolves, and the list must still render it rather than
   * fail. The id stays on the resource so the row can link to the user
   * regardless.
   */
  ownerUsername: z.string().optional(),
  /*
   * `z.datetime()`, not `z.date()`. In this framework `z.date()` is
   * `zod.iso.date()` — a date-only `YYYY-MM-DD` — while these columns carry a
   * full ISO timestamp, so `z.date()` rejects every row at serialization
   * with "Invalid ISO date". Matches `sessionResourceSchema`.
   */
  createdAt: z.datetime(),
  updatedAt: z.datetime().optional(),
  /**
   * Members of this project, counted for the page being displayed only — one
   * extra query per page rather than one per row.
   */
  memberCount: z.integer(),
});

export type AdminProjectResource = Infer<typeof adminProjectResourceSchema>;
