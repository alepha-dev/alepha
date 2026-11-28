import { Button, Textarea, UserAvatar } from "@alepha/ui";
import { useAuth } from "alepha/react/auth";
import { Send } from "lucide-react";
import type { ClipboardEvent, ReactNode } from "react";

import type { ElementRef } from "../element/elementRef.ts";
import LoreEditor from "../element/LoreEditor.tsx";

export interface DiscussionComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /**
   * A write is in flight: the box freezes and the button disables together.
   */
  busy: boolean;
  /**
   * The post the button started is in flight: the button spins. Apart from
   * `busy`, which also covers the page's other writes (an upload, a delete),
   * so the button never spins for work it did not start.
   */
  sending?: boolean;
  /**
   * Whether there is something to post. Defaults to a non-blank `value`; a
   * composer that also posts attachments widens it.
   */
  canSubmit?: boolean;
  placeholder: string;
  submitLabel: string;
  /**
   * The element the comment belongs to. Given, the box is a `LoreEditor`
   * (toolbar, `[[` completion, `@` picker). Absent, it is a plain
   * `Textarea`: the feedback reporter's own sheet, where their words render
   * as plain text and a format toolbar would hand them syntax they then see
   * literally.
   */
  element?: ElementRef;
  /**
   * The handles the `@` picker offers. Editor only.
   */
  members?: string[];
  /**
   * `false` turns off the editor's own image paste, for a caller that takes
   * pasted files itself through `onPasteFiles`.
   */
  imageUpload?: boolean;
  /**
   * Files pasted into the box. When set, a paste that carries files goes
   * here and never reaches the editor.
   */
  onPasteFiles?: (files: File[]) => void;
  /**
   * Above the box: the files waiting to go with the comment.
   */
  attachments?: ReactNode;
  /**
   * The button row's left side: a line saying who will be notified.
   */
  hint?: ReactNode;
  /**
   * Buttons before the submit one: Attach files.
   */
  actions?: ReactNode;
}

/**
 * The composer at the foot of a discussion, shared by a quest's, a feedback
 * item's and an error's (in core since #E185): the viewer's avatar in the feed's gutter, the box, then a
 * row with the caller's hint and actions and the submit button.
 *
 * It holds no state of its own: the draft, the post and any attachments are
 * the caller's, since each posts to its own endpoint.
 */
const DiscussionComposer = (props: DiscussionComposerProps) => {
  const auth = useAuth();
  const canSubmit = props.canSubmit ?? props.value.trim().length > 0;

  // In the CAPTURE phase, so a pasted file is taken before CodeMirror's own
  // paste handler sees it; text is left alone.
  const onPasteCapture = (event: ClipboardEvent) => {
    if (!props.onPasteFiles) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    props.onPasteFiles(files);
  };

  return (
    // Same gutter as the rows above, so the composer reads as the next entry
    // in the feed rather than a form bolted under it. The slot sets the
    // editor in the app's text face (`main.css`, #Q4056): a comment is
    // prose, written in the face it is read in.
    <div data-slot="discussion-composer" className="flex gap-3 px-1 pt-3">
      <UserAvatar
        public
        fileId={(auth.user as { picture?: string } | undefined)?.picture}
        className="mt-1 size-7 shrink-0"
        alt=""
      />
      <div
        className="flex min-w-0 flex-1 flex-col gap-2"
        onPasteCapture={onPasteCapture}
      >
        {props.attachments}
        {props.element ? (
          <LoreEditor
            element={props.element}
            // `field`, so the fixed format toolbar is on and the height is a
            // box on a form rather than a document.
            variant="field"
            value={props.value}
            onChange={props.onChange}
            // ⚠️ A real freeze, not a `disabled` the editor would ignore: it
            // reaches CodeMirror's own `readOnly` through the wrapper. The
            // button below disables at the same moment, so the two agree.
            readOnly={props.busy}
            // ⚠️ Only comments get `@`, and the scoping IS the feature:
            // `expandCommentReferences` and `MentionNotifier` only run over
            // comments, so a picker on a description or a folio body would
            // offer a handle that links nowhere and pings nobody.
            mentionSuggestions={props.members}
            imageUpload={props.imageUpload}
            minHeight={120}
            placeholder={props.placeholder}
          />
        ) : (
          <Textarea
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            placeholder={props.placeholder}
            rows={3}
            disabled={props.busy}
          />
        )}
        <div className="flex items-center gap-2">
          {props.hint && (
            <span className="text-muted-foreground min-w-0 text-xs">
              {props.hint}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {props.actions}
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit}
              loading={props.sending}
              onClick={props.onSubmit}
            >
              <Send className="size-4" />
              {props.submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiscussionComposer;
