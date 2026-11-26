import { Badge, TimeAgo } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Bot, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import type { I18n } from "../../../services/I18n.ts";

export interface DiscussionCommentProps {
  /**
   * Who wrote it, already resolved to a name (or the tombstone for a
   * deleted account).
   */
  author: string;
  /**
   * Set when an agent wrote it over MCP. `title` is the client's name, shown
   * on hover.
   */
  agent?: { title?: string };
  at: string | Date;
  edited?: boolean;
  /**
   * Controls at the end of the header line, after the time: a delete.
   */
  actions?: ReactNode;
  /**
   * The body, inside the bordered box. Absent for a comment that is only
   * attachments, which then shows no empty box.
   */
  children?: ReactNode;
  /**
   * Under the body: a comment's attachments.
   */
  footer?: ReactNode;
  /**
   * `data-testid` of the row, for a feed whose specs tell its comments from
   * its events.
   */
  testId?: string;
}

/**
 * One comment in a discussion feed, shared by a quest's, a feedback item's
 * and an error's (in core since #E185, so Ship can draw one): a glyph in the gutter, the header line ("X commented", the agent
 * badge, the time), then the body in a box underneath.
 *
 * The body is the caller's, because the two differ in what they may render:
 * a quest comment is Markdown, and a feedback reporter's words stay plain
 * text (see `FeedbackThreadBody`).
 */
const DiscussionComment = (props: DiscussionCommentProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <li className="flex gap-3 py-3" data-testid={props.testId}>
      {/* The same bordered circle every event uses, carrying a chat glyph.
          A comment is an entry in the feed like any other, so the gutter
          keeps one shape: an avatar there made comments the only rows with
          a face, at a size that broke the column's rhythm. Who wrote it is
          already the first thing on the line beside it. */}
      <span className="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border">
        {props.agent ? (
          <Bot className="size-3.5" />
        ) : (
          <MessageSquare className="size-3.5" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* `min-h-7` matches the circle so the header line is centred on it
            rather than sitting on its text baseline. */}
        <div className="flex min-h-7 items-center gap-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{props.author}</span>{" "}
            <span className="text-muted-foreground">
              {tr("quest.discussion.commented")}
            </span>
          </span>
          {/* Next to the name, not in place of it: the account really did
              post this, and saying otherwise would hide who to ask about
              it. The badge answers the different question of whether a
              person chose those words. */}
          {props.agent && (
            <Badge
              variant="secondary"
              className="text-muted-foreground shrink-0"
              title={props.agent.title ?? tr("quest.discussion.agent.hint")}
            >
              {tr("quest.discussion.agent")}
            </Badge>
          )}
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {props.edited && (
              <span className="mr-1 italic">
                {tr("quest.discussion.edited")}
              </span>
            )}
            <TimeAgo value={props.at} />
          </span>
          {props.actions}
        </div>
        {props.children && (
          <div className="border-border bg-muted/40 rounded-md border px-4 py-3">
            {props.children}
          </div>
        )}
        {props.footer}
      </div>
    </li>
  );
};

export default DiscussionComment;
