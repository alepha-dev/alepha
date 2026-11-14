import {
  LoreViewer,
  mentionPattern,
  resolveMentionCapture,
} from "@lore/core/web";
import { Link } from "alepha/react/router";
import { Fragment, type ReactNode } from "react";

import {
  expandCommentReferences,
  protectedSegments,
} from "../quest/commentReferences.ts";

export interface FeedbackThreadBodyProps {
  body: string;
  /**
   * The project's members, as the mention list. Empty on the reporter's own
   * sheet, which is outside the project shell and has no roster to read -
   * and where every handle therefore stays plain text, which is correct.
   */
  members: Array<{ name: string }>;
  projectSlug?: string;
  /**
   * Render the body as Markdown (#Q3451), through the viewer quest comments
   * use. Set for a reply from the team or an agent, never for the reporter's
   * own words: see the component doc.
   */
  markdown?: {
    projectId: number;
    feedbackId: number;
  };
}

/**
 * A feedback comment's body: plain text with resolved mentions as links for
 * the reporter's own words, Markdown for a reply from the team or an agent.
 *
 * ⚠️ **No markdown for the reporter, and that is the point.** A reporter is
 * an outsider and this body is shown to the project owner, the same reason a
 * error's fields are never rendered as markdown. Concretely, `MarkdownView`
 * loads a Markdown image from wherever it points, so a reporter's
 * `![](https://their-server/x.png)` would make the owner's browser call that
 * server on opening the inbox, telling it who read the report and when.
 * The plain path does not reverse that: it splits the text on the shared mention matcher
 * and emits an `<a>` only for a handle that resolved to a real member of
 * this project. Everything else is a text node, which React escapes, so the
 * outsider-input posture is unchanged and the surface is strictly narrower
 * than markdown.
 *
 * The same four shapes the server holds out are held out here, from the same
 * regex, so a handle inside a code span neither links nor pings.
 *
 * ## Markdown for the team's replies (#Q3451)
 *
 * The posture above is about the REPORTER's words. A reply written by the
 * project's own people, or by an agent working for them, is not outsider
 * input: it renders as Markdown through `LoreViewer`, the quest comments'
 * renderer (sanitized, no raw HTML), with `#Q12` and `@member` expanded the
 * same way. `FeedbackThread` decides which is which from the comment's author
 * against the item's reporter.
 */
const FeedbackThreadBody = (props: FeedbackThreadBodyProps) => {
  if (props.markdown) {
    return (
      <LoreViewer
        element={{
          kind: "feedback",
          projectId: props.markdown.projectId,
          projectSlug: props.projectSlug ?? "",
          id: props.markdown.feedbackId,
        }}
        content={expandCommentReferences(props.body, {
          projectSlug: props.projectSlug ?? "",
          members: props.members,
        })}
      />
    );
  }
  return <p className="text-sm whitespace-pre-wrap">{renderSegments(props)}</p>;
};

const renderSegments = (props: FeedbackThreadBodyProps): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let key = 0;

  for (const segment of protectedSegments(props.body)) {
    if (segment.protected || props.members.length === 0) {
      nodes.push(<Fragment key={key++}>{segment.text}</Fragment>);
      continue;
    }

    let cursor = 0;
    for (const match of segment.text.matchAll(mentionPattern())) {
      const resolved = resolveMentionCapture(match[2] ?? "", props.members);
      if (!resolved) continue;
      // The handle without the full stop or hyphen that may have ended the
      // sentence: that stays in the text after the link.
      const handle = resolved.handle;

      // `match.index` points at the prefix character the pattern needs to
      // prove the `@` starts a handle, so the token itself begins after it.
      const start = (match.index ?? 0) + (match[1]?.length ?? 0);
      nodes.push(
        <Fragment key={key++}>{segment.text.slice(cursor, start)}</Fragment>,
      );
      nodes.push(
        props.projectSlug ? (
          <Link
            key={key++}
            href={`/${props.projectSlug}/settings/members`}
            className="text-primary hover:underline"
          >
            @{handle}
          </Link>
        ) : (
          <span key={key++} className="text-primary">
            @{handle}
          </span>
        ),
      );
      cursor = start + 1 + handle.length;
    }

    nodes.push(<Fragment key={key++}>{segment.text.slice(cursor)}</Fragment>);
  }

  return nodes;
};

export default FeedbackThreadBody;
