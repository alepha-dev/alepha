import { Button } from "@alepha/ui";
import {
  DiscussionComment,
  expandCommentReferences,
  type I18n,
  LoreViewer,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";

import type { ProjectErrorThreadEntry } from "../../../../../api/schemas/projectErrorThreadEntrySchema.ts";

export interface ProjectErrorThreadCommentProps {
  entry: ProjectErrorThreadEntry;
  projectId: number;
  projectSlug: string;
  errorId: number;
  /**
   * The project's member handles, for the `@name` links in a body.
   */
  members: string[];
  /**
   * Set on the viewer's own comment: nobody removes another member's words
   * here.
   */
  onDelete?: () => void;
  busy: boolean;
}

/**
 * One comment of an error's thread: the shared `DiscussionComment` card,
 * with the body rendered as Markdown and the agent mark when a machine
 * wrote it.
 *
 * ⚠️ The body is the member's or the agent's own markdown, which is why it
 * may be rendered. The error's own text never reaches this component.
 */
const ProjectErrorThreadComment = (props: ProjectErrorThreadCommentProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { entry } = props;
  return (
    <DiscussionComment
      testId="error-thread-comment"
      // A member can delete their account: the comment stays, under a
      // tombstone.
      author={entry.userName || tr("quest.discussion.author.unknown")}
      // Over MCP and the CLI the account is the key's owner: without this
      // mark an agent's finding reads as that member's own words.
      agent={
        entry.source ? { title: entry.source.client ?? undefined } : undefined
      }
      at={entry.at}
      edited={!!entry.editedAt}
      actions={
        props.onDelete && (
          <Button
            type="button"
            variant="minimal"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            aria-label={tr("errors.thread.delete")}
            data-testid="error-thread-comment-delete"
            disabled={props.busy}
            onClick={props.onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )
      }
    >
      <LoreViewer
        className="[&>:first-child]:mt-0 [&>:last-child]:mb-0"
        element={{
          kind: "error",
          projectId: props.projectId,
          projectSlug: props.projectSlug,
          id: props.errorId,
        }}
        content={expandCommentReferences(entry.body ?? "", {
          projectSlug: props.projectSlug,
          members: props.members.map((name) => ({ name })),
        })}
      />
    </DiscussionComment>
  );
};

export default ProjectErrorThreadComment;
