import type { CompletionSource } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type MouseEvent as ReactMouseEvent, useEffect, useRef } from "react";

import { createMarkdownExtensions } from "./codeMirrorSetup.ts";
import { imageMarkdown, insertAtCursor } from "./insertAtCursor.ts";

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  readOnly?: boolean;
  /**
   * Show the numbered gutter. See `MarkdownExtensionOptions.lineNumbers`.
   *
   * ⚠️ Read at MOUNT ONLY — the extension list is built inside the
   * create-once effect below. Fine for a per-surface constant, which is all
   * it is used for; wiring it to a live toggle would need the extension
   * reconfigured through a compartment, which it is not.
   */
  lineNumbers?: boolean;
  /**
   * Completion sources for the `[[` picker. Presence, not identity, decides
   * whether autocompletion is mounted — the sources themselves read their
   * data through a getter, so a new array every render is harmless.
   */
  completionSources?: CompletionSource[];
  /**
   * Uploads a pasted or dropped image and resolves to the markdown to
   * insert at the caret. Omitted → paste and drop keep CodeMirror's default
   * behaviour, which is what a protected folio needs: its bytes must never
   * be written in plaintext next to encrypted content.
   */
  imageUploadHandler?: (file: File) => Promise<string>;
  /**
   * Handed the live view on mount and `null` on unmount, so a caller can
   * dispatch into it — the Edit-mode ⌘F handler needs one.
   */
  onViewReady?: (view: EditorView | null) => void;
}

/**
 * CodeMirror 6 as Lore's raw-markdown surface.
 *
 * ## The four mechanisms that are NOT here, on purpose
 *
 * The MDXEditor this replaced needed `userTouched`, `lastEmitted`, a
 * focus-guarded sync effect and `normalizeEditorMarkdown` — all four
 * because Lexical parsed the markdown and re-serialised it, so the string
 * coming out was never the string that went in. That produced real bugs: a
 * freshly-opened document reported unsaved changes before anyone touched
 * it, a stale echo treated as an external reset ate list items under the
 * cursor, and `[[…]]` got escaped on save, silently dropping the link
 * graph.
 *
 * CodeMirror's document IS the string. So the sync effect below is a plain
 * equality check with no focus heuristic: our own `onChange` echo is
 * identical to the doc we already hold and exits on the first comparison.
 * Do not add a focus guard back — if this effect ever seems to need one,
 * something upstream is rewriting the markdown and that is the bug.
 */
const CodeMirrorEditor = (props: CodeMirrorEditorProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Read through refs so the mount effect can stay `[]`. Depending on the
  // callbacks would tear down and rebuild the editor on every parent
  // render, dropping the caret, the undo history and the scroll position.
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const completionSourcesRef = useRef(props.completionSources);
  completionSourcesRef.current = props.completionSources;
  const onViewReadyRef = useRef(props.onViewReady);
  onViewReadyRef.current = props.onViewReady;
  const imageUploadRef = useRef(props.imageUploadHandler);
  imageUploadRef.current = props.imageUploadHandler;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          ...createMarkdownExtensions({
            placeholder: props.placeholder,
            readOnly: props.readOnly,
            lineNumbers: props.lineNumbers,
            // One stable source that delegates to whatever the latest
            // sources are, so the extension list — and therefore the
            // editor — is never rebuilt when they change identity.
            completionSources: completionSourcesRef.current?.length
              ? [
                  (context) => {
                    for (const source of completionSourcesRef.current ?? []) {
                      const result = source(context);
                      if (result) return result;
                    }
                    return null;
                  },
                ]
              : undefined,
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste: (event, view) => {
              const upload = imageUploadRef.current;
              if (!upload) return false;
              const file = Array.from(event.clipboardData?.items ?? [])
                .find(
                  (item) =>
                    item.kind === "file" && item.type.startsWith("image/"),
                )
                ?.getAsFile();
              // Not an image paste — let CodeMirror handle it as text.
              if (!file) return false;
              event.preventDefault();
              void upload(file).then((reference) => {
                insertAtCursor(view, imageMarkdown(file.name, reference));
              });
              return true;
            },
            drop: (event, view) => {
              const upload = imageUploadRef.current;
              if (!upload) return false;
              const file = Array.from(event.dataTransfer?.files ?? []).find(
                (candidate) => candidate.type.startsWith("image/"),
              );
              if (!file) return false;
              event.preventDefault();
              void upload(file).then((reference) => {
                insertAtCursor(view, imageMarkdown(file.name, reference));
              });
              return true;
            },
          }),
        ],
      }),
    });

    viewRef.current = view;
    onViewReadyRef.current?.(view);

    return () => {
      onViewReadyRef.current?.(null);
      view.destroy();
      viewRef.current = null;
    };
    // Mount once. `props.value` is deliberately absent — the effect below
    // owns every later value change.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === props.value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.value },
    });
  }, [props.value]);

  /**
   * Put the caret at the end when the click lands in the box but outside the
   * text, the way every textarea behaves.
   *
   * `.cm-editor` is stretched to the host below, but CodeMirror only
   * hit-tests inside `.cm-content`, so the gap under a short document
   * swallowed the click and the field looked dead everywhere but its first
   * line. Guarded on the target so a click ON the text still goes to CM and
   * lands where the reader aimed.
   */
  const focusEnd = (event: ReactMouseEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view || (event.target as HTMLElement).closest(".cm-content")) return;
    event.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  };

  return (
    // Wrapper around the CodeMirror instance, which owns its own key handling.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={hostRef}
      onMouseDown={focusEnd}
      // `min-w-0` because grid and flex items default to `min-width: auto`,
      // which forbids shrinking below min-content width. Two quest dialogs
      // embed this and had exactly that overflow bug once.
      // `min-height: inherit` on `.cm-editor`: `minHeight` below sits on THIS host,
      // while CodeMirror sizes itself to its content, so a short document
      // left the rest of the box as dead space no click reached. Every
      // textarea on earth puts the caret at the end when you click its
      // empty lower half. Stretching CM to the host is half of that; the
      // `onMouseDown` above is the other half, because CM hit-tests only
      // inside `.cm-content`.
      //
      // `inherit`, not `min-h-full`: a percentage min-height resolves
      // against the parent's HEIGHT, and the host only sets `min-height`,
      // so `100%` collapsed to nothing and CodeMirror stayed 20px tall in a
      // 246px box.
      className="min-w-0 [&>.cm-editor]:[min-height:inherit]"
      style={props.minHeight ? { minHeight: props.minHeight } : undefined}
    />
  );
};

export default CodeMirrorEditor;
