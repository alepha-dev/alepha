import type { EditorView } from "@codemirror/view";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { type ReactElement, useMemo } from "react";
import { createPortal } from "react-dom";

import type { Folio } from "@/api/entities/folios.ts";

import { currentFolioBlobsAtom } from "../../../../atoms/currentFolioBlobsAtom.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import type { ElementRef } from "../../../shared/element/elementRef.ts";
import LoreEditor from "../../../shared/element/LoreEditor.tsx";
import type { MarkdownEditorMode } from "../../../shared/markdown-editor/MarkdownEditorInner.tsx";
import FolioPassphraseDialog from "../../FolioPassphraseDialog.tsx";
import WikiLinkHoverProvider from "../../WikiLinkHoverProvider.tsx";
import FolioMenubar from "../menubar/FolioMenubar.tsx";
import { useFolioShortcuts } from "../menubar/useFolioShortcuts.ts";
import type { UseFolioActionsResult } from "../useFolioActions.ts";
import type { FolioDraft } from "../useFolioDraft.ts";
import FolioLockedPanel from "./FolioLockedPanel.tsx";
import FolioMoveDialog from "./FolioMoveDialog.tsx";
import FolioSummaryField from "./FolioSummaryField.tsx";

export interface FolioDocumentProps {
  /**
   * `undefined` → create mode.
   */
  folio?: Folio;
  /**
   * Create-mode only: the directory the new folio will land in (carried
   * from `FolioCreatePage`'s `?dir=` resolution). Read only when `folio` is
   * unset — an existing folio's real `directoryId` always wins once it
   * exists. It is what the Move dialog opens on, so that creating a folio
   * from inside a directory (via "+ Create → New folio") and then moving it
   * starts from where the folio is about to land, not from the project root.
   */
  directoryId?: string;
  draft: FolioDraft;
  actions: UseFolioActionsResult;
  /**
   * Where the menubar row renders — a slot above all three panes, owned by
   * `FolioWorkspace`.
   *
   * It is a portal target purely for LAYOUT now. It used to be a necessity:
   * the menubar had to be created inside MDXEditor's realm, the only place
   * its formatting commands could be published from, so it was rendered
   * through `renderToolbar` and portalled back up to where the design
   * wanted it. With the formatting commands gone there is no realm and no
   * second `toolbarSlot` — the row is plain React that happens to render
   * somewhere else in the DOM.
   */
  chromeSlot: HTMLElement | null;
  /**
   * Which face the body shows. Owned by `FolioWorkspaceContent` because
   * `useFolioActions` needs a toggle for `view.mode` (⌘E) and that is where
   * the hook is called.
   */
  mode: MarkdownEditorMode;
  /**
   * The `[[` picker's entries and the rewritten markdown View mode shows.
   * Computed one level up because find-in-folio has to key on the rendered
   * string — see `FolioWorkspaceContent`.
   */
  element: ElementRef;
  /**
   * The rewritten markdown, computed by the workspace because
   * `useFolioFind` needs it too. `LoreEditor` would derive the same value
   * on its own; it is passed so both halves of the pane search and render
   * the identical string.
   */
  rendered: string;
  /** `false` for a protected folio — see `LoreEditor.imageUpload`. */
  imageUpload?: boolean;
  /**
   * Receives the live CodeMirror view so the workspace can dispatch
   * formatting commands into it. `null` on unmount.
   */
  onEditorViewReady?: (view: EditorView | null) => void;
}

/**
 * The document column: summary → divider → body. Body is either the
 * `MarkdownEditor` (rendered or raw, per `props.mode`) or, for a
 * protected-and-still-locked folio, `FolioLockedPanel` in its place.
 *
 * There is no chrome row above the body anymore. `FolioMetaBar` — the
 * directory chip, the tag chips, and `#id · N words · N revisions` — was
 * deleted with the tag feature (feedback #62): the directory is already
 * shown by the tree, and the three counters were reporting numbers nobody
 * acts on. Moving a folio survives that deletion because `folio.move` is a
 * menubar action, which is where it was always reachable from anyway. The
 * one control the row did carry, the view/edit toggle, now floats over the
 * top-right of the pane — mounted in `FolioWorkspaceContent` so it does not
 * scroll away with the document.
 *
 * Also owns the menubar chrome and the keyboard shortcuts that drive it.
 * `useFolioShortcuts` is called HERE, not inside `FolioMenubar`,
 * deliberately: this component never unmounts while a folio is open (only
 * the `MarkdownEditor`/`FolioLockedPanel` ternary below swaps), so binding
 * shortcuts here — once — keeps every `availableWhenLocked` action (the
 * pane toggles, ⌘S, ⌘D, …) reachable by keyboard the whole time, including
 * while `FolioMenubar` itself isn't mounted (locked).
 *
 * The mode is threaded into `useFolioShortcuts` because ⌘F means two
 * different things: in View mode this hook claims it for the find bar, and
 * in Edit mode it stands aside so `@codemirror/search` gets the keydown.
 * See that hook's `editorOwnsBinding` for why the walk-the-text-nodes
 * implementation cannot serve both.
 */
const FolioDocument = (props: FolioDocumentProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [blobs] = useStore(currentFolioBlobsAtom);
  const [project] = useStore(currentProjectAtom);

  useFolioShortcuts(
    props.actions.handlers,
    props.actions.actionState,
    props.mode,
  );

  const values = props.draft.values;
  // The hover card resolves a blob preview from a precomputed list rather
  // than a fetch, so it needs the same rows the resolver got.
  const hoverBlobs = useMemo(
    () =>
      blobs.map((b) => ({
        fileId: b.id,
        shortId: b.shortId,
        name: b.name,
      })),
    [blobs],
  );

  // Absent on every project that has not opted in — the key is deliberately
  // missing from `defaultProjectFeatures` (adding it there would change the
  // `projects` column DEFAULT and trigger the D1 rebuild that cascade-wipes
  // prod), so `?? false` is the default, not a fallback.
  const summaryVisible = project?.features?.folioSummary ?? false;

  // `props.actions.directoryId` (LIVE — moved by `confirmMove`'s own
  // success), NOT `props.folio?.directoryId`. The latter is the
  // route-loader snapshot, so after a successful in-session move the Move
  // dialog would reopen on the OLD directory until a full reload. In create
  // mode `props.actions.directoryId` is always `undefined` (no folio yet),
  // so this falls through to the create-mode target directory.
  const directoryId = props.actions.directoryId ?? props.directoryId;

  return (
    // `data-slot` is what `FolioTitleField` scopes its Enter-moves-to-body
    // lookup to — the tree and the inspector carry `contenteditable` nodes
    // of their own, so a document-wide query would land in the wrong one.
    <div data-slot="folio-document" className="flex flex-col gap-0">
      {/* A LAYOUT portal, nothing more. The menubar used to be created
          inside MDXEditor's realm and portalled up here, which forced a
          `loadingChrome` stand-in for the second before the editor chunk
          landed — the row was simply absent until then, and popped in. It
          is plain React now, so it renders on the first paint like
          everything else. */}
      {props.chromeSlot &&
        createPortal(
          <FolioMenubar
            handlers={props.actions.handlers}
            state={props.actions.actionState}
            saving={props.actions.saving}
            dirty={props.draft.dirty}
          />,
          props.chromeSlot,
        )}

      {/* Off unless the project opts in (Settings › Folios). The summary is
          written for `project_context` / `folio_list`, so for a reader it is
          chrome above the first line of prose. Hiding the field does not stop
          it round-tripping — the draft still carries the stored value and
          still saves it.

          It is the ONLY chrome left above the body, so it now carries the
          padding the deleted header row used to provide, and the rule below
          renders with it rather than unconditionally: a divider with nothing
          above it is not separating anything, it is just a line under the
          menubar. */}
      {summaryVisible && (
        <>
          <div className="px-8 pt-4">
            <FolioSummaryField
              value={values.summary}
              onChange={(v) => props.draft.form.input.summary.set(v)}
              unavailable={props.actions.actionState.isProtected}
            />
          </div>

          {/* Edge to edge, unlike everything under it. The rule separates the
              document's chrome from the document, so it has to reach the
              pane's own edges — inside the prose measure it read as an
              underline on the summary field rather than as a division of the
              surface. */}
          <div className="border-border border-t" />
        </>
      )}

      {/* BODY — the only part still held to the 812px prose measure. This
          wrapper used to live in `FolioWorkspaceContent` and enclose the
          header and the rule as well, which is what kept all three the same
          width. */}
      <div className="mx-auto w-full max-w-[812px] px-8 py-8">
        {props.actions.locked ? (
          <FolioLockedPanel
            onUnlock={props.actions.unlock}
            onDelete={() => props.actions.handlers["folio.delete"]()}
          />
        ) : (
          // Same hover card the reader gets. The provider delegates on both
          // `a[href]` and `[data-wiki-href]`, so one component serves the
          // rewritten markdown of `MarkdownView` and the decorated tokens of
          // the editor without either knowing about the other.
          <WikiLinkHoverProvider
            projectId={project?.id ?? 0}
            projectSlug={project?.slug ?? ""}
            blobs={hoverBlobs}
          >
            <LoreEditor
              element={props.element}
              // `"document"` is what turns on the line-number gutter and the
              // taller default: a folio body is long enough for "the table
              // around line 40" to be a usable coordinate. The quest and
              // epic description fields are `"field"` and get neither.
              variant="document"
              bare
              value={values.content}
              onChange={(v) => props.draft.form.input.content.set(v)}
              placeholder={tr("folios.content-placeholder")}
              imageUpload={props.imageUpload}
              // CONTROLLED: the menubar and ⌘E own the mode here, so the
              // editor must not render its own toggle or hold its own state.
              mode={props.mode}
              onViewReady={props.onEditorViewReady}
            />
          </WikiLinkHoverProvider>
        )}
      </div>

      <FolioMoveDialog
        open={props.actions.moveDialogOpen}
        folioTitle={
          values.title.trim() || String(tr("folios.title-placeholder"))
        }
        currentDirectoryId={directoryId}
        onCancel={props.actions.closeMoveDialog}
        onConfirm={props.actions.confirmMove}
      />

      <FolioPassphraseDialog
        open={props.actions.encryptDialogOpen}
        onOpenChange={(open) => {
          if (!open) props.actions.closeEncryptDialog();
        }}
        title={tr("folios.protected.encrypt-title")}
        description={tr("folios.protected.encrypt-description")}
        submitLabel={tr("folios.protected.encrypt")}
        requireConfirm
        onSubmit={props.actions.confirmEncrypt}
      />
    </div>
  );
};

export default FolioDocument;
