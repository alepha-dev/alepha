import { type I18n, LoreEmptyState } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";

import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";

export interface ProjectFeedbackEmptyStateProps {
  /**
   * Which filter the list is showing. Decides the whole message, because an
   * empty Accepted tab and an empty Pending tab mean opposite things.
   */
  status: FeedbackResource["status"];

  /**
   * Whether the list beside this pane has rows in it. The distinction is the
   * entire point of this component: with rows, nothing is selected yet; with
   * none, there is nothing to select and saying otherwise is a dead end.
   */
  hasItems: boolean;
}

/**
 * The detail pane with no feedback open, said by the Lore companion
 * (`LoreEmptyState`) in the mood each case calls for:
 *
 * - rows in the list and none open: `seeking`, her beam turned to the list.
 * - an empty Pending tab: `calm`. Nothing is waiting, which is good news.
 * - an empty Accepted or Rejected tab: `asleep`. Nothing has happened yet.
 *
 * It used to be one message for both states this pane can be in: an `Inbox`
 * glyph and "Select an item from the list" - the same glyph the list beside
 * it shows when it is empty, next to an instruction that could not be
 * followed, because on a desktop viewport a selection is only ever absent
 * when the list has nothing in it. `ProjectFeedback` auto-selects the first
 * row on load and after every reload, so "nothing selected" and "nothing to
 * select" arrive together and the pane was answering the rarer one.
 *
 * That rarer one is real, though, and is why `hasItems` exists rather than
 * this branching on `status` alone. Below `md` the list and the detail swap
 * places, Back clears the selection to bring the list forward, and widening
 * the window past `md` from there leaves a populated list with nothing open.
 *
 * It carries no action. The feedback form used to be a button here, on the
 * empty Pending tab only; it is the list header's "+" since #Q4449, where it
 * is reachable whatever the tab and however full the list.
 */
const ProjectFeedbackEmptyState = (
  props: ProjectFeedbackEmptyStateProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();

  if (props.hasItems) {
    return (
      <LoreEmptyState
        mood="seeking"
        title={tr("feedback.empty.selectOne")}
        description={tr("feedback.empty.selectOneBody")}
      />
    );
  }

  return (
    <LoreEmptyState
      mood={props.status === "pending" ? "calm" : "asleep"}
      title={tr(`feedback.empty.detail.${props.status}.title` as const)}
      description={tr(`feedback.empty.detail.${props.status}.body` as const)}
    />
  );
};

export default ProjectFeedbackEmptyState;
