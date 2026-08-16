import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import type { EditorView } from "@codemirror/view";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { type ReactElement, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Folio } from "@/api/entities/folios.ts";
import { currentFolioBlobsAtom } from "../../../../atoms/currentFolioBlobsAtom.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import MarkdownEditor from "../../../shared/markdown-editor/MarkdownEditor.tsx";
import type { MarkdownEditorMode } from "../../../shared/markdown-editor/MarkdownEditorInner.tsx";
import MarkdownModeToggle from "../../../shared/markdown-editor/MarkdownModeToggle.tsx";
import FolioPassphraseDialog from "../../FolioPassphraseDialog.tsx";
import WikiLinkHoverProvider from "../../WikiLinkHoverProvider.tsx";
import FolioMenubar from "../menubar/FolioMenubar.tsx";
import { useFolioShortcuts } from "../menubar/useFolioShortcuts.ts";
import type { UseFolioActionsResult } from "../useFolioActions.ts";
import type { FolioDraft } from "../useFolioDraft.ts";
import type { FolioWikiLinks } from "../wikilink/useFolioWikiLinks.ts";
import FolioLockedPanel from "./FolioLockedPanel.tsx";
import FolioMetaBar from "./FolioMetaBar.tsx";
import FolioMoveDialog from "./FolioMoveDialog.tsx";
import FolioSummaryField from "./FolioSummaryField.tsx";
import FolioTitleField from "./FolioTitleField.tsx";

export interface FolioDocumentProps {
  /**
   * `undefined` → create mode.
   */
  folio?: Folio;
  /**
   * Create-mode only: the directory the new folio will land in (carried
   * from `FolioCreatePage`'s `?dir=` resolution). Read only when `folio` is
   * unset — an existing folio's real `directoryId` always wins once it
   * exists. Without this, the meta bar's directory chip showed "Project
   * root" while creating a folio from inside a directory (via "+ Create →
   * New folio"), even though the folio was about to be created there.
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
  wikiLinks: FolioWikiLinks;
  /**
   * Revision count for the meta bar's "$3 revisions" — sourced from the
   * inspector's History tab (`FolioInspector`'s `onRevisionCount`), via
   * `FolioWorkspaceContent`. `undefined` until that tab's own
   * `listHistory` fetch resolves (or in create mode, where there is no
   * history yet); the meta bar already handles that (`revisionCount ?? 0`).
   */
  revisionCount?: number;
  imageUploadHandler?: (file: File) => Promise<string>;
  /**
   * Receives the live CodeMirror view so the workspace can dispatch
   * formatting commands into it. `null` on unmount.
   */
  onEditorViewReady?: (view: EditorView | null) => void;
}

/**
 * Rough word count over the raw markdown — deliberately not stripping
 * syntax (`#`, `*`, links): a whitespace split is the honest "how much did
 * you type" number the meta bar wants, matching the same level of
 * simplicity as the deleted `FolioEditor.tsx`'s token estimator
 * (`Math.ceil(content.length / 4)`), not a prose-accurate word counter.
 */
const countWords = (content: string): number => {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};

/**
 * The document column: title → meta bar → summary → divider → body. Body
 * is either the `MarkdownEditor` (rendered or raw, per `props.mode`) or,
 * for a protected-and-still-locked folio, `FolioLockedPanel` in its place.
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
  const dialog = useDialog();
  const [directories] = useStore(projectDirectoriesAtom);
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

  const disabled = props.actions.locked;

  // `props.actions.directoryId` (LIVE — moved by `confirmMove`'s own
  // success), NOT `props.folio?.directoryId`. The latter is the
  // route-loader snapshot: reading it directly here reproduced the exact
  // staleness bug the reviewer flagged for `isProtected` elsewhere in this
  // task, just for the directory chip instead — after a successful
  // in-session move, the chip kept showing the OLD directory until a full
  // reload. In create mode `props.actions.directoryId` is always
  // `undefined` (no folio yet), so this falls through to the create-mode
  // target directory (`props.directoryId`) so the chip shows where the
  // folio WILL land, not always "Project root" while creating.
  const directoryId = props.actions.directoryId ?? props.directoryId;
  const directoryName = directoryId
    ? (directories.find((d) => d.id === directoryId)?.name ?? "…")
    : tr("folio.move.root");

  const handleAddTag = async () => {
    const value = await dialog.prompt({
      title: tr("folios.editor.tag.add"),
      placeholder: String(tr("folios.editor.tag.add")),
    });
    const trimmed = value?.trim();
    if (!trimmed) return;
    if (values.tags.includes(trimmed)) return;
    props.draft.form.input.tags.set([...values.tags, trimmed]);
  };

  const handleRemoveTag = (tag: string) => {
    props.draft.form.input.tags.set(values.tags.filter((t) => t !== tag));
  };

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
            statusKey={props.draft.statusKey}
            savedAt={props.draft.savedAt}
            saving={props.actions.saving}
            dirty={props.draft.dirty}
          />,
          props.chromeSlot,
        )}

      {/* Title and mode toggle share a row: the toggle acts on the document
          the title names, so this is where it is looked for. `items-start`
          because the title wraps to several lines at long titles and the
          control should stay on the first one. */}
      <div className="flex items-start gap-2">
        <FolioTitleField
          value={values.title}
          onChange={(v) => props.draft.form.input.title.set(v)}
          disabled={disabled}
        />
        <MarkdownModeToggle
          mode={props.mode}
          onChange={() => props.actions.handlers["view.mode"]()}
          disabled={props.actions.locked}
          iconOnly
        />
      </div>

      <FolioMetaBar
        directoryName={directoryName}
        tags={values.tags}
        shortId={props.folio?.shortId}
        wordCount={countWords(values.content)}
        revisionCount={props.revisionCount}
        disabled={disabled}
        moveDisabled={!props.folio}
        onOpenMove={() => props.actions.handlers["folio.move"]()}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
      />

      {/* Off unless the project opts in (Settings › Folios). The summary is
          written for `project_context` / `folio_list`, so for a reader it is
          chrome between the title and the first line of prose. Hiding the
          field does not stop it round-tripping — the draft still carries the
          stored value and still saves it. */}
      {summaryVisible && (
        <FolioSummaryField
          value={values.summary}
          onChange={(v) => props.draft.form.input.summary.set(v)}
          unavailable={props.actions.actionState.isProtected}
        />
      )}

      <div className="border-border my-6 border-t" />

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
          <MarkdownEditor
            value={values.content}
            onChange={(v) => props.draft.form.input.content.set(v)}
            placeholder={tr("folios.content-placeholder")}
            imageUploadHandler={props.imageUploadHandler}
            wikiLinkSuggestions={props.wikiLinks.suggestions}
            viewContent={props.wikiLinks.rendered}
            mode={props.mode}
            minHeight={420}
            variant="bare"
            onViewReady={props.onEditorViewReady}
          />
        </WikiLinkHoverProvider>
      )}

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
