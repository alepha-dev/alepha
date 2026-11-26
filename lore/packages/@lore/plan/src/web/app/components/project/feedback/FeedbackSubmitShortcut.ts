import type { KeyboardEvent } from "react";

/**
 * The Submit feedback form's keyboard shortcut (#Q4453): Cmd+Enter on macOS,
 * Ctrl+Enter elsewhere, pressed in the message, submits its form, unless it
 * is busy (submitting, or an attachment still uploading), the guard its
 * submit button has. A plain Enter is left alone, so the message takes a new
 * line.
 */
export class FeedbackSubmitShortcut {
  public static onKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    busy: boolean,
  ): void {
    if (event.key !== "Enter") return;
    if (!(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (busy) return;
    event.currentTarget.form?.requestSubmit();
  }
}
