import type { ProjectActivityRow } from "@/api/schemas/projectActivityRowSchema.ts";

/**
 * Where an activity row points, or `undefined` when it points nowhere.
 *
 * A plain path rather than a `router.push(name, params)` pair, because the
 * params differ per kind (`shortId`, `epicNumber`, `releaseTag`) and threading
 * a discriminated union through the call site buys nothing a string does not.
 *
 * ⚠️ `resourceId` is written as the identifier each kind is ADDRESSED by, not
 * as its row id: a quest's `shortId`, an epic's `number`, a release's `tag`.
 * That is decided at the write site (`QuestController.logQuest` and friends),
 * and this function is what depends on it - a row id here produces a link to a
 * page that does not exist, silently, since a 404 only happens on click.
 *
 * Kinds with no page of their own return `undefined` and render as plain text:
 * a member join has no member page, and a deleted quest's link would resolve
 * to a 404. Deletions are deliberately not special-cased into a live check -
 * the row is a record of what happened, and reading every referenced row back
 * to decide whether to underline it would be a query per row.
 */
export const activityResourceHref = (
  projectSlug: string,
  row: Pick<ProjectActivityRow, "type" | "action" | "resourceId">,
): string | undefined => {
  if (!row.resourceId || row.action === "delete") {
    return undefined;
  }
  const base = `/${projectSlug}`;
  switch (row.type) {
    case "quest":
      return `${base}/quests/${row.resourceId}`;
    case "epic":
      return `${base}/epics/${row.resourceId}`;
    case "release":
      return `${base}/releases/${encodeURIComponent(row.resourceId)}`;
    case "folio":
      return `${base}/folios/${row.resourceId}`;
    // The inbox, not a per-item page: a feedback item is opened in a drawer
    // over the list and has no URL of its own.
    case "feedback":
      return `${base}/feedback`;
    default:
      return undefined;
  }
};
