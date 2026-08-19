import { createElement, useMemo } from "react";
import type { ElementRef } from "./elementRef.ts";
import LoreEditor from "./LoreEditor.tsx";

/**
 * A `LoreEditor` shaped for `Control`'s `custom` slot, bound to one element.
 *
 * `Control custom` hands its component only `{ value, onChange }`, so the
 * element has to be closed over. Doing that inline at the call site would
 * mint a NEW component type on every parent render, and React unmounts the
 * old tree when a component's identity changes — the editor would remount
 * and drop focus on every keystroke that re-rendered the form. This hook is
 * what keeps the identity stable, memoised on the element's primitive
 * fields rather than on the object, which is rebuilt each render.
 *
 * It replaces `QuestDescriptionEditor` and `EpicDescriptionEditor`, which
 * were the same file twice and had already drifted: one had image upload,
 * the other did not, and neither offered `[[` suggestions.
 */
export const useLoreEditorControl = (
  element: ElementRef,
  options?: { placeholder?: string; minHeight?: number },
) => {
  const { kind, projectId, projectSlug, id } = element;
  const placeholder = options?.placeholder;
  const minHeight = options?.minHeight;

  return useMemo(
    () => (props: { value?: unknown; onChange?: (value: unknown) => void }) =>
      createElement(LoreEditor, {
        element: { kind, projectId, projectSlug, id },
        value: typeof props.value === "string" ? props.value : "",
        onChange: (v: string) => props.onChange?.(v),
        placeholder,
        minHeight,
      }),
    [kind, projectId, projectSlug, id, placeholder, minHeight],
  );
};
