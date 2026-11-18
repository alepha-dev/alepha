import { type FocusEvent, useCallback, useRef } from "react";

/**
 * Where a placeholder chip writes (#Q3848): the text field focused last in
 * a row's form. `onFocusCapture` goes on the form; `insert` writes a
 * `{{name}}` at that field's caret, through the field's own input event,
 * so the form it belongs to sees an ordinary edit.
 */
export const useAutomationOutlineInsert = () => {
  const last = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const onFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        (target.type === "text" || target.type === "search"))
    )
      last.current = target;
  }, []);
  const insert = useCallback((name: string) => {
    const field = last.current;
    if (!field || !field.isConnected) return false;
    const token = `{{${name}}}`;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const next = field.value.slice(0, start) + token + field.value.slice(end);
    // The prototype's setter, so React sees the value change as typed.
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, next);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    field.setSelectionRange(start + token.length, start + token.length);
    return true;
  }, []);
  return { onFocusCapture, insert };
};
