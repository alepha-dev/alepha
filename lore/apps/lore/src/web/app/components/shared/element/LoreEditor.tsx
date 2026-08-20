import type { EditorView } from "@codemirror/view";
import { useState } from "react";
import MarkdownEditor from "../markdown-editor/MarkdownEditor.tsx";
import type { MarkdownEditorMode } from "../markdown-editor/MarkdownEditorInner.tsx";
import MarkdownModeToggle from "../markdown-editor/MarkdownModeToggle.tsx";
import type { ElementRef } from "./elementRef.ts";
import { useElementImageUpload } from "./useElementImageUpload.ts";
import { useElementLinks } from "./useElementLinks.ts";

export interface LoreEditorProps {
  element: ElementRef;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * `"document"` is a body someone came here to read and write — a folio.
   * It gets line numbers and a taller default. `"field"` is a box on a
   * form; it gets neither, and starts in Edit because the author came to
   * fill it in.
   */
  variant?: "document" | "field";
  minHeight?: number;
  /**
   * CONTROLLED mode. Pass both to drive the view/edit state from outside —
   * the folio workspace does, because its menubar and ⌘E own the mode and
   * it has to survive a re-render.
   *
   * Omit both and the editor owns the state AND renders the toggle itself.
   * That is what the four quest surfaces and the epic description each used
   * to hand-roll: the same `useState` + `MarkdownModeToggle` pair, copied
   * five times.
   */
  mode?: MarkdownEditorMode;
  onModeChange?: (mode: MarkdownEditorMode) => void;
  /** Hide the built-in toggle in uncontrolled mode (rare — a bare field). */
  hideModeToggle?: boolean;
  /**
   * `false` suppresses image upload. A protected folio passes it: its bytes
   * must never be written in plaintext beside encrypted content.
   */
  imageUpload?: boolean;
  /** Renders without the input frame — the folio body's full-bleed look. */
  bare?: boolean;
  onViewReady?: (view: EditorView | null) => void;
}

/**
 * The markdown editing surface for any element.
 *
 * The writer half of the pair `LoreViewer` / `LoreEditor`, and the single
 * place that decides what an element's editor can do. Before it there were
 * five near-identical wrappers — `QuestDescriptionEditor`,
 * `EpicDescriptionEditor` and three inline copies in quest dialogs — each
 * re-deciding the mode toggle and the upload target, and only ONE surface
 * (the folio body) ever passed `wikiLinkSuggestions`. So `[[` autocomplete
 * existed on exactly one screen while the syntax it inserts worked on
 * three.
 *
 * Everything a surface used to choose is now derived from `element`:
 * suggestions and the rendered View come from {@link useElementLinks}, and
 * the image-upload target from {@link useElementImageUpload}. A new
 * element kind gets all of it by construction rather than by remembering.
 */
const LoreEditor = (props: LoreEditorProps) => {
  const variant = props.variant ?? "field";
  const [ownMode, setOwnMode] = useState<MarkdownEditorMode>("edit");

  const controlled = props.mode !== undefined;
  const mode = controlled ? props.mode : ownMode;
  // Never undefined: in controlled mode the toggle below is not rendered, so
  // the fallback is only ever reached by a caller that passed `mode` without
  // `onModeChange` — where doing nothing is the honest behaviour.
  const setMode = (controlled ? props.onModeChange : setOwnMode) ?? (() => {});

  const imageUploadHandler = useElementImageUpload(
    props.element,
    props.imageUpload !== false,
  );
  const { suggestions, rendered } = useElementLinks(props.element, props.value);

  return (
    // `relative`, so the toggle floats INSIDE the field's top-right corner.
    // It used to sit in a row of its own above the editor, which cost a line
    // of vertical space on every form and read as a label for the field
    // rather than a control on it. Same treatment the folio workspace
    // already gives it, which is why `iconOnly` and `className` exist.
    <div className="relative">
      {!controlled && !props.hideModeToggle && (
        <MarkdownModeToggle
          mode={mode ?? "edit"}
          onChange={setMode}
          iconOnly
          // Transparent with a border, not a filled chip: it sits inside the
          // field, and a solid block in the corner read as a separate
          // control pasted on top of the input rather than part of it.
          className="absolute top-1.5 right-1.5 z-10 border bg-transparent"
        />
      )}
      <MarkdownEditor
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
        mode={mode}
        // View mode shows the RESOLVED markdown; Edit always shows the raw
        // stored text, which is what makes the round-trip lossless.
        viewContent={rendered}
        wikiLinkSuggestions={suggestions}
        imageUploadHandler={imageUploadHandler}
        lineNumbers={variant === "document"}
        minHeight={props.minHeight ?? (variant === "document" ? 420 : 220)}
        variant={props.bare ? "bare" : undefined}
        onViewReady={props.onViewReady}
      />
    </div>
  );
};

export default LoreEditor;
