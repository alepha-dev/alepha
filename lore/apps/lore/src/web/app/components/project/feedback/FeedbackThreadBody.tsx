import { Link } from "alepha/react/router";
import { Fragment, type ReactNode } from "react";

import { mentionPattern, resolveMention } from "../../../services/mentions.ts";
import { protectedSegments } from "../quest/commentReferences.ts";

export interface FeedbackThreadBodyProps {
  body: string;
  /**
   * The project's members, as the mention list. Empty on the reporter's own
   * sheet, which is outside the project shell and has no roster to read -
   * and where every handle therefore stays plain text, which is correct.
   */
  members: Array<{ name: string }>;
  projectSlug?: string;
}

/**
 * A feedback comment's body: plain text, with resolved mentions as links.
 *
 * ⚠️ **Still no markdown, and that is the point.** A reporter is an outsider
 * and this body is shown to the project owner, which is why the thread has
 * never rendered markdown - the same reason a blight's fields do not. This
 * does not reverse that: it splits the text on the shared mention matcher
 * and emits an `<a>` only for a handle that resolved to a real member of
 * this project. Everything else is a text node, which React escapes, so the
 * outsider-input posture is unchanged and the surface is strictly narrower
 * than markdown.
 *
 * The same four shapes the server holds out are held out here, from the same
 * regex, so a handle inside a code span neither links nor pings.
 */
const FeedbackThreadBody = (props: FeedbackThreadBodyProps) => {
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
      const handle = match[2] ?? "";
      const member = resolveMention(handle, props.members);
      if (!member) continue;

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
