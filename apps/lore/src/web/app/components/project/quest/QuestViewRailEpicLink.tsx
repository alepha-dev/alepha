import { Link } from "alepha/react/router";

import { formatReference } from "../../shared/element/typedReference.ts";

export interface QuestViewRailEpicLinkProps {
  /**
   * The epic's per-project number, not its id. `#E43` is what a reader types
   * and searches for; the id is never shown anywhere.
   */
  number: number;
  title: string;
  href: string;
}

/**
 * The epic row of the quest rail: the reference, with the title on hover.
 *
 * ⚠️ The title is not dropped, it MOVES. `#E43` on its own is an unlabelled
 * link to a screen reader, so the title has to survive as the accessible name
 * even though it is no longer drawn. `title` for a pointer and `aria-label`
 * for a reader, which is the rule #Q2017 recorded for the icon-only prompt
 * trigger; a purely visual tooltip would satisfy the first and fail the
 * second.
 *
 * Extracted from `QuestViewRail` rather than left inline, so this pair can be
 * pinned by a spec without mounting the whole rail - which reaches for a
 * router, the project atom, the epic client, the assignee picker and the
 * release control before it draws anything.
 *
 * The rail is a narrow column of short values: an area name, a release tag.
 * The epic row was the only one holding a sentence, and on a quest under
 * `#E43 UX/UI - Refonte du poste agent` it filled the column and pushed the
 * rows either side out of alignment (feedback #P2166).
 */
const QuestViewRailEpicLink = (props: QuestViewRailEpicLinkProps) => {
  // ⚠️ Through `formatReference`, never built by hand. It is the one
  // implementation of the `#E43` grammar (epic #E32).
  const reference = formatReference("epic", props.number);

  return (
    <Link
      className="hover:underline"
      title={props.title}
      aria-label={`${reference} ${props.title}`}
      href={props.href}
    >
      {reference}
    </Link>
  );
};

export default QuestViewRailEpicLink;
