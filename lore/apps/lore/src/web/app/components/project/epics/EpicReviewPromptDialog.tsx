import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRef, useState } from "react";

import { epicReviewPromptAtom } from "@/web/app/atoms/epicReviewPromptAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * The epic-review prompt, editable before it is copied (feedback #2097).
 *
 * #2087 shipped Review as a blind write to the clipboard: the reader never
 * saw the text they were about to paste, and could not add the one sentence
 * of context that makes a review land. This is the same prompt, shown first.
 *
 * ## ⚠️ Why this is a dialog of its own rather than `dialog.prompt`
 *
 * `use-dialog`'s prompt resolves a PROMISE, so a caller's `writeText` would
 * run in a `.then()` after the click handler returned. Chrome tolerates that;
 * Safari's transient activation does not reliably survive the microtask, and
 * the write rejects. The quest that asked for this named the measurement and
 * the fallback: if the gesture chain does not survive, the copy button has to
 * live inside the dialog and do the write itself.
 *
 * I could not run that measurement - there is no Safari here - so this takes
 * the branch that is correct under EITHER answer. The copy happens in this
 * component's own `onClick`, inside the gesture, with no promise in between.
 *
 * Two smaller reasons it earns its own file anyway: a thirty-line prompt in
 * `dialog.prompt`'s single-line `<Input>` is unusable, and that input submits
 * on Enter, which is actively wrong for multi-line text somebody is editing.
 *
 * ## Mounted once, in `Layout`
 *
 * Two surfaces open it - the Epics row menu and the epic page - and both
 * reach it through `useEpicReviewPrompt` writing `epicReviewPromptAtom`, so
 * neither call site knows this component exists and the two cannot diverge.
 * Same shape as `Spotlight`.
 */
const EpicReviewPromptDialog = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [pending, setPending] = useStore(epicReviewPromptAtom);
  const [text, setText] = useState("");

  /**
   * Seed the editor when a prompt OPENS, and never again while it is open.
   *
   * Adjusted during render rather than in an effect, the pattern
   * `FolioTreeRow` documents: an effect that seeds on every `pending` change
   * fights the reader's own typing, and one that seeds on mount alone cannot
   * reopen. The ref is cleared on close, so reopening the same epic gets the
   * freshly built prompt back rather than last time's edits.
   */
  const seededRef = useRef<string | undefined>(undefined);
  if (pending && seededRef.current !== pending.text) {
    seededRef.current = pending.text;
    setText(pending.text);
  } else if (!pending && seededRef.current !== undefined) {
    seededRef.current = undefined;
  }

  const close = () => setPending(undefined);

  const copy = async () => {
    // The write is INSIDE this click, which is the whole point of the
    // component. `await` before the toast, not after the call: `writeText`
    // rejects on an insecure context or a denied permission, and a toast
    // fired before it resolved would be a lie. Same try/catch/toast pair the
    // row menu's copy-id action established.
    try {
      await navigator.clipboard.writeText(text);
      toaster.success(
        tr("epic.action.review.copied", { args: [pending?.reference ?? ""] }),
      );
      close();
    } catch {
      // Left OPEN on failure, deliberately: the text is still on screen and
      // can be selected by hand, which is the only recourse when the
      // clipboard is unavailable. Closing would take away the fallback.
      toaster.error(tr("epic.action.review.error"));
    }
  };

  return (
    <Dialog open={pending !== undefined} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr("epic.action.review.dialog.title")}</DialogTitle>
          <DialogDescription>
            {tr("epic.action.review.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label={String(tr("epic.action.review.dialog.label"))}
          data-testid="epic-review-prompt-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="max-h-[50vh] min-h-64 font-mono text-xs"
        />
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {tr("common.cancel")}
          </Button>
          <Button onClick={() => void copy()}>
            {tr("epic.action.review.dialog.copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EpicReviewPromptDialog;
