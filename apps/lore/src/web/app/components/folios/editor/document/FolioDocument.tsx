import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
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
import FolioPassphraseDialog from "../../FolioPassphraseDialog.tsx";
import WikiLinkHoverProvider from "../../WikiLinkHoverProvider.tsx";
import FolioEditorMenubar from "../menubar/FolioEditorMenubar.tsx";
import FolioMenubar from "../menubar/FolioMenubar.tsx";
import { useFolioShortcuts } from "../menubar/useFolioShortcuts.ts";
import FolioToolbar from "../toolbar/FolioToolbar.tsx";
import type { UseFolioActionsResult } from "../useFolioActions.ts";
import type { FolioDraft } from "../useFolioDraft.ts";
import { useWikiLinkEditorContext } from "../wikilink/useWikiLinkEditorContext.ts";
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
   * Where the MENUBAR row renders. It is created inside MDXEditor's realm
   * — the only place its commands can be published from — but the design
   * puts it above all three panes, so `renderToolbar` portals it into this
   * node rather than rendering it in place. See `FolioWorkspace.tsx` for
   * the full reasoning.
   */
  chromeSlot: HTMLElement | null;
  /**
   * Where the FORMATTING TOOLBAR renders — a second target inside the
   * document column, owned by `FolioWorkspaceContent`. The two rows shared
   * `chromeSlot` until it became clear they are not the same kind of
   * thing: the menubar carries folio-level actions (move, delete, the pane
   * toggles) that apply with nothing selected and even while the folio is
   * locked, so it is workspace chrome; the toolbar is nothing but
   * text-formatting commands, so it belongs to the text. Same portal
   * mechanism, different destination.
   */
  toolbarSlot: HTMLElement | null;
  /**
   * Revision count for the meta bar's "$3 revisions" — sourced from the
   * inspector's History tab (`FolioInspector`'s `onRevisionCount`), via
   * `FolioWorkspaceContent`. `undefined` until that tab's own
   * `listHistory` fetch resolves (or in create mode, where there is no
   * history yet); the meta bar already handles that (`revisionCount ?? 0`).
   */
  revisionCount?: number;
  imageUploadHandler?: (file: File) => Promise<string>;
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
 * is either the editable MDXEditor or, for a protected-and-still-locked
 * folio, `FolioLockedPanel` in its place.
 *
 * Also owns the menubar/toolbar chrome (Task 11) and the keyboard
 * shortcuts that drive it. `useFolioShortcuts` is called HERE, not inside
 * `FolioMenubar`, deliberately: this component never unmounts while a
 * folio is open (only the `MarkdownEditor`/`FolioLockedPanel` ternary
 * below swaps), so binding shortcuts here — once — keeps every
 * `availableWhenLocked` action (the pane toggles, ⌘S, ⌘D, …) reachable by
 * keyboard the whole time, including while `FolioMenubar` itself isn't
 * mounted (locked). See `useFolioActions.ts`'s doc on `editorCommandsRef`
 * for how `props.actions.handlers` still resolves the realm-backed
 * `edit.*`/`insert.*` ids correctly despite `useFolioShortcuts` living
 * outside the realm.
 */
const FolioDocument = (props: FolioDocumentProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [directories] = useStore(projectDirectoriesAtom);
  const [blobs] = useStore(currentFolioBlobsAtom);
  const [project] = useStore(currentProjectAtom);

  useFolioShortcuts(props.actions.handlers, props.actions.actionState);

  const wikiLinks = useWikiLinkEditorContext(project?.id, project?.slug);
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

  /**
   * Content stores `assets/<name>`, which the browser cannot load — resolve
   * it to the real file URL for display only. The markdown is untouched, so
   * what gets saved (and exported) stays the portable relative path.
   *
   * An unknown name is returned unchanged rather than blanked: the editor
   * then shows a broken image where the author put one, which is the honest
   * signal that the attachment is gone.
   */
  const imagePreviewHandler = useMemo(() => {
    const byName = new Map(
      blobs.map((b) => [b.name.trim().toLowerCase(), b.id]),
    );
    return async (src: string): Promise<string> => {
      const match = /^assets\/(.+)$/i.exec(src);
      if (!match) return src;
      const id = byName.get(decodeURIComponent(match[1]).trim().toLowerCase());
      return id ? `/api/files/${id}` : src;
    };
  }, [blobs]);

  // Absent on every project that has not opted in — the key is deliberately
  // missing from `defaultProjectFeatures` (adding it there would change the
  // `projects` column DEFAULT and trigger the D1 rebuild that cascade-wipes
  // prod), so `?? false` is the default, not a fallback.
  const summaryVisible = project?.features?.folioSummary ?? false;

  const values = props.draft.values;
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
      <FolioTitleField
        value={values.title}
        onChange={(v) => props.draft.form.input.title.set(v)}
        disabled={disabled}
      />

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
            imagePreviewHandler={imagePreviewHandler}
            allowImageResize
            wikiLinks={wikiLinks}
            minHeight={420}
            variant="bare"
            // The menubar is created inside MDXEditor's realm and portalled up
            // — so a cold editor chunk meant the chrome row was simply ABSENT
            // for about a second on every first folio open, then popped in.
            // Reserving its height would have hidden the layout jump and left
            // the flicker; this renders the real row immediately, from outside
            // the realm, with `editorLoading` greying out only the commands
            // that genuinely need one. Suspense swaps it for the realm-backed
            // `FolioEditorMenubar` when the chunk lands, so the two are never
            // mounted together.
            loadingChrome={
              props.chromeSlot
                ? createPortal(
                    <FolioMenubar
                      handlers={props.actions.handlers}
                      state={{
                        ...props.actions.actionState,
                        editorLoading: true,
                      }}
                      hasImageUpload={!!props.imageUploadHandler}
                      statusKey={props.draft.statusKey}
                      savedAt={props.draft.savedAt}
                    />,
                    props.chromeSlot,
                  )
                : null
            }
            renderToolbar={() => (
              // Two portals, not one. Both keep their row inside MDXEditor's
              // React tree — so `usePublisher`/`useCellValue` still resolve
              // against the live realm — while putting the DOM where the
              // design has it: the menubar above all three panes, the
              // formatting toolbar inside the document column with the text
              // it acts on. Rendering in place until a slot exists would
              // flash the row in the wrong position on first paint, so each
              // renders nothing until its own target is there.
              <>
                {props.chromeSlot &&
                  createPortal(
                    <FolioEditorMenubar
                      handlers={props.actions.handlers}
                      state={props.actions.actionState}
                      hasImageUpload={!!props.imageUploadHandler}
                      onEditorCommands={props.actions.registerEditorCommands}
                      statusKey={props.draft.statusKey}
                      savedAt={props.draft.savedAt}
                    />,
                    props.chromeSlot,
                  )}
                {props.toolbarSlot &&
                  createPortal(
                    <FolioToolbar
                      handlers={props.actions.handlers}
                      state={props.actions.actionState}
                      saving={props.actions.saving}
                      dirty={props.draft.dirty}
                      hasImageUpload={!!props.imageUploadHandler}
                    />,
                    props.toolbarSlot,
                  )}
              </>
            )}
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
