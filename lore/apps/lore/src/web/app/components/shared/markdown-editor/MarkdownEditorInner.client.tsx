import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import type { EditorView } from "@codemirror/view";
import { useMemo, useRef, useState } from "react";

import type { WikiLinkSuggestion } from "../../folios/editor/wikilink/wikiLinkSuggestion.ts";
import CodeMirrorEditor from "./CodeMirrorEditor.tsx";
import MarkdownFormatToolbar from "./MarkdownFormatToolbar.tsx";
import MarkdownSelectionToolbar from "./MarkdownSelectionToolbar.tsx";
import MarkdownToolbarBand from "./MarkdownToolbarBand.tsx";
import { createMentionCompletion } from "./mentionCompletion.ts";
import { createWikiLinkCompletion } from "./wikiLinkCompletion.ts";

export type MarkdownEditorMode = "view" | "edit";

export interface MarkdownEditorInnerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Freeze the text while a save is in flight.
   *
   * ⚠️ It reaches CodeMirror's own `readOnly`, which is why it exists as a
   * pass-through rather than a `disabled` prop the wrapper swallows: a
   * control that draws itself disabled and still accepts keystrokes is worse
   * than one that never claimed to.
   */
  readOnly?: boolean;
  minHeight?: number;
  /**
   * Show the numbered gutter in EDIT mode. View mode renders through
   * `MarkdownView` and has no gutter to show.
   *
   * Off by default and opted into per surface: a folio body is a long
   * document where a line number is a usable coordinate, while a quest or
   * epic description is a form field, and numbering one reads as an IDE.
   */
  lineNumbers?: boolean;
  /**
   * `"view"` renders through `MarkdownView`; `"edit"` mounts CodeMirror.
   *
   * Controlled by the caller rather than held here, so the folio workspace
   * can drive it from the menubar and ⌘E and the mode survives a re-render.
   * Defaults to `"view"`: a folio is a document you read far more often than
   * you write. Quest fields pass `"edit"` — a description on a form is a
   * field you are filling in, not a document.
   */
  mode?: MarkdownEditorMode;
  /**
   * Uploads a picked/pasted image and resolves to the reference to embed.
   * Omitted → paste and drop are not intercepted at all, which is what a
   * protected folio wants (its bytes must never be written in plaintext).
   */
  imageUploadHandler?: (file: File) => Promise<string>;
  /**
   * Entries for the `[[` picker. Absent → no autocompletion extension is
   * mounted, so nothing pops up while typing prose. Read through a getter
   * inside the completion source, so a new array each render is harmless.
   */
  wikiLinkSuggestions?: WikiLinkSuggestion[];
  /**
   * Handles the `@` picker offers, as display names.
   *
   * ⚠️ **Present only where a mention MEANS something**: the comment
   * surfaces, where `expandCommentReferences` turns a handle into a link and
   * `MentionNotifier` pings its owner. Absent everywhere else, so a folio
   * body or a description never offers a completion that would resolve
   * nowhere from either end.
   */
  mentionSuggestions?: string[];

  /**
   * What VIEW mode renders instead of `value`. Edit mode always shows
   * `value` — the raw, stored markdown.
   *
   * The folio workspace passes `value` run through `rewriteFolioWikiLinks`,
   * which turns `[[…]]` into real links and `assets/<name>` into
   * `/api/files/<id>`. Without it a folio in View mode shows `[[#F12]]` as
   * literal text and every attachment as a broken image, since a relative
   * `assets/` path resolves to nothing against the app's URL.
   *
   * A separate prop rather than a transform applied here, because the
   * lookups it needs (folios, quests, epics, attachments) belong to the
   * caller — the quest surfaces have none of them and pass nothing.
   */
  viewContent?: string;
  /**
   * `"bare"` drops the frame — border, radius, background. The folio
   * workspace uses it because the document there is the page itself, not a
   * field on a form: the design runs the prose straight on under the summary
   * divider rather than boxing it in. Every other caller keeps the frame.
   */
  variant?: "framed" | "bare";
  /**
   * A fixed row of formatting buttons at the top of the frame, in edit
   * mode only (feedback #2056). The floating selection toolbar stays
   * either way. Off by default: the folio document has its menubar, and a
   * second bar there would say everything twice; `LoreEditor` turns it on
   * for its `field` variant, the description boxes on forms.
   */
  formatToolbar?: boolean;
  onViewReady?: (view: EditorView | null) => void;
}

/**
 * The real editor, behind `MarkdownEditor`'s lazy boundary: two faces over
 * one markdown string, rendered or raw.
 *
 * Markdown is the single source of truth and this is a view over it — with
 * the difference, versus the MDXEditor it replaced, that neither face ever
 * rewrites the string. A round-trip through view and back is a no-op by
 * construction rather than by four compensating mechanisms; see
 * `CodeMirrorEditor` for what those were and why they are gone.
 */
const MarkdownEditorInner = (props: MarkdownEditorInnerProps) => {
  // A stable box the completion source reads the latest suggestions out of.
  // The source is created once (below) so the editor is never rebuilt, but
  // the list behind it changes while the editor stays mounted.
  const suggestionsRef = useRef(props.wikiLinkSuggestions);
  suggestionsRef.current = props.wikiLinkSuggestions;
  // Same ref treatment, same reason: the member list arrives after mount and
  // a captured array would freeze empty.
  const mentionsRef = useRef(props.mentionSuggestions);
  mentionsRef.current = props.mentionSuggestions;

  // ⚠️ Built ONCE and never re-derived from the props: both sources read
  // through a ref, so a new array each render costs nothing, where a memo
  // keyed on the arrays would rebuild the editor's extensions on every
  // keystroke of the parent.
  const completionSources = useMemo(
    () => [
      createWikiLinkCompletion(() => suggestionsRef.current ?? []),
      createMentionCompletion(() => mentionsRef.current ?? []),
    ],
    [],
  );

  // The live editor, held as STATE rather than a ref: the selection
  // toolbar is a sibling component that must re-render once the view
  // exists, and a ref assignment would not trigger that.
  const [view, setView] = useState<EditorView | null>(null);

  const bare = props.variant === "bare";
  // Same surface as `Textarea` and `Input`: transparent in light, `input/30`
  // in dark, `rounded-lg`. It was `bg-background rounded-md`, which read as a
  // different KIND of control sitting next to the fields it shares a form
  // with.
  const frame = bare
    ? ""
    : "border-input dark:bg-input/30 rounded-lg border bg-transparent p-3";

  if (props.mode === "edit") {
    return (
      <div className={`lore-md-edit min-w-0 ${frame}`.trim()}>
        {/* Mounted only once the editor exists — before that it has no
            selection to act on, and mounting it early would make every
            consumer of this component need an i18n provider it does not
            otherwise require. */}
        {view && <MarkdownSelectionToolbar view={view} />}
        {/* ⚠️ The band before the buttons. `onViewReady` fires in an effect,
            so there is at least one paint with no editor yet - and without
            the fallback the strip's height would arrive one frame late,
            which is the same jump feedback #P2147 is about, just smaller
            and only on mount. */}
        {props.formatToolbar &&
          (view ? (
            <MarkdownFormatToolbar view={view} flush={!bare} />
          ) : (
            <MarkdownToolbarBand flush={!bare} />
          ))}
        <CodeMirrorEditor
          value={props.value}
          onChange={props.onChange}
          placeholder={props.placeholder}
          readOnly={props.readOnly}
          minHeight={props.minHeight}
          lineNumbers={props.lineNumbers}
          imageUploadHandler={props.imageUploadHandler}
          // Presence, not identity: an editor with no suggestions must not
          // mount autocompletion at all, or a popup appears over prose.
          // ⚠️ Presence of EITHER list mounts autocompletion, and neither
          // source fires without its own: a surface with members and no
          // wiki-link suggestions still gets `@`, and one with neither
          // mounts nothing at all rather than a popup over prose.
          completionSources={
            props.wikiLinkSuggestions || props.mentionSuggestions
              ? completionSources
              : undefined
          }
          onViewReady={(next) => {
            // Two consumers: the floating toolbar below needs it to
            // position itself, and the caller needs it for the menubar's
            // formatting commands.
            setView(next);
            props.onViewReady?.(next);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`lore-md-view min-w-0 ${frame}`.trim()}
      style={props.minHeight ? { minHeight: props.minHeight } : undefined}
    >
      {/* ⚠️ The same band, empty (feedback #P2147). Without it the strip's
          height left the layout on every Preview, and everything below slid
          up - on a form, the button a reader was about to press moved under
          their pointer. The formatting buttons do not come with it: they
          act on a CodeMirror selection, and there is none over rendered
          output.

          Gated on `formatToolbar` for the same reason the edit branch is: a
          consumer that never had a band must not gain an empty one. */}

      {props.formatToolbar && <MarkdownToolbarBand flush={!bare} />}
      <MarkdownView content={props.viewContent ?? props.value} />
    </div>
  );
};

export default MarkdownEditorInner;
