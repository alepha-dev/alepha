import type { CompletionSource } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { createMarkdownExtensions } from "./codeMirrorSetup.ts";
import { insertAtCursor } from "./insertAtCursor.ts";

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  readOnly?: boolean;
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
                insertAtCursor(view, reference);
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
                insertAtCursor(view, reference);
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

  return (
    <div
      ref={hostRef}
      // `min-w-0` because grid and flex items default to `min-width: auto`,
      // which forbids shrinking below min-content width. Two quest dialogs
      // embed this and had exactly that overflow bug once.
      className="min-w-0"
      style={props.minHeight ? { minHeight: props.minHeight } : undefined}
    />
  );
};

export default CodeMirrorEditor;
