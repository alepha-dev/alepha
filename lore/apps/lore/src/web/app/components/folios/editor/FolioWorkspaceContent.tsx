import { Control } from "@alepha/ui/components/control/control";
import { ControlSelect } from "@alepha/ui/components/control-select/control-select";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useAlepha,
  useClient,
  useInject,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Save } from "lucide-react";
import type { ReactElement } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentFolioAtom } from "../../../atoms/currentFolioAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { folioTagsAtom } from "../../../atoms/folioTagsAtom.ts";
import { userFoliosAtom } from "../../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import MarkdownEditor from "../../shared/markdown-editor/MarkdownEditor.tsx";
import { useFolioImageUpload } from "../../shared/markdown-editor/useFolioImageUpload.ts";
import FolioProtectedView from "../FolioProtectedView.tsx";
import { useFolioDraft } from "./useFolioDraft.ts";

export interface FolioWorkspaceContentProps {
  /**
   * `undefined` → create mode. A `Folio` → edit mode.
   */
  folio?: Folio;
  /**
   * Create-mode only: the directory the new folio lands in.
   */
  directoryId?: string;
}

/**
 * The workspace's actual content — draft buffer, save action, and the
 * minimal title/tags/body layout. Split out of `FolioWorkspace` so the
 * latter can `key` this whole subtree on the folio id (see the comment
 * there); everything stateful about editing ONE folio lives here so a
 * remount is enough to reset all of it.
 *
 * Save is intentionally minimal here: it persists title/tags/summary/
 * content for a plain folio via `FolioController`. It does not attempt
 * the protected-folio re-encryption flow — that is the "security-critical"
 * path Task 8's `useFolioActions` owns (it needs `CryptoProvider` and the
 * cached passphrase-derived key this hook does not have access to), so a
 * protected folio renders read-only here via the existing
 * `FolioProtectedView` and Save is disabled for it. Sending
 * `draft.values.content` (blanked for a protected folio, see
 * `useFolioDraft`) to `folioApi.update` would otherwise silently replace
 * the encrypted body with an empty plaintext one.
 */
const FolioWorkspaceContent = (
  props: FolioWorkspaceContentProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const folioApi = useClient<FolioController>();
  const [project] = useStore(currentProjectAtom);
  const [folios, setFolios] = useStore(userFoliosAtom);
  const [tags, setTags] = useStore(folioTagsAtom);
  const projectId = project ? String(project.id) : "";

  const draft = useFolioDraft(props.folio);
  const isProtected = !!props.folio?.protected;

  const imageUploadHandler = useFolioImageUpload(project?.id, !isProtected);

  const saveAction = useAction(
    {
      handler: async () => {
        if (isProtected || !project) {
          // Defense in depth: the Save button below is already disabled
          // whenever the open folio is protected, but a disabled prop is
          // not a guarantee against a stray call. See the file comment.
          return;
        }

        const values = draft.values;
        const title =
          values.title.trim() || String(tr("folios.title-placeholder"));

        const saved = props.folio
          ? await folioApi.update({
              params: { id: props.folio.id },
              body: {
                title,
                tags: values.tags,
                summary: values.summary,
                content: values.content,
              },
            })
          : await folioApi.create({
              body: {
                title,
                tags: values.tags,
                summary: values.summary,
                content: values.content,
                protected: false,
                projectId: project.id,
                directoryId: props.directoryId,
              },
            });

        alepha.store.set(currentFolioAtom, saved as Folio);
        setFolios(
          props.folio
            ? folios.map((f) => (f.id === saved.id ? (saved as Folio) : f))
            : [saved as Folio, ...folios],
        );
        const merged = new Set<string>(tags);
        for (const t of saved.tags) merged.add(t);
        setTags([...merged].sort());
        draft.markSaved(saved.updatedAt, { ...values, title });

        // Create mode navigates to the folio's own URL so a reload lands
        // on the saved document rather than a fresh draft.
        if (!props.folio) {
          await router.push(
            router.path("projectFoliosFolio", {
              params: { projectId, shortId: saved.shortId },
            }),
          );
        }
      },
      invalidates: [["folioTree", projectId]],
    },
    [
      isProtected,
      project,
      props.folio,
      props.directoryId,
      draft,
      folioApi,
      alepha,
      folios,
      setFolios,
      tags,
      setTags,
      router,
      projectId,
      tr,
    ],
  );

  // The escape hatch for a protected folio whose passphrase is genuinely
  // lost — surfaced by `FolioProtectedView`'s "Lost the passphrase?"
  // link. Ported from the deleted `FolioView.tsx`'s `handleDelete`;
  // general delete/pin/duplicate/encrypt for a NON-protected folio is not
  // wired here on purpose — those left with `FolioView` and come back
  // with Task 8's `useFolioActions`.
  const deleteAction = useAction(
    {
      handler: async () => {
        if (!props.folio) return;
        const id = props.folio.id;
        await folioApi.delete({ params: { id } });
        const remaining = folios.filter((f) => f.id !== id);
        setFolios(remaining);
        const remainingTags = new Set<string>();
        for (const f of remaining) for (const t of f.tags) remainingTags.add(t);
        setTags([...remainingTags].sort());
        alepha.store.set(currentFolioAtom, undefined);
        await router.push(
          router.path("projectFolios", { params: { projectId } }),
        );
      },
      invalidates: [["folioTree", projectId]],
    },
    [
      props.folio,
      folios,
      setFolios,
      setTags,
      alepha,
      router,
      projectId,
      folioApi,
    ],
  );

  const handleDeleteUnrecoverable = async () => {
    const confirmed = await dialog.confirm({
      title: tr("folios.confirm-delete-title"),
      description: tr("folios.confirm-delete-message"),
      destructive: true,
    });
    if (confirmed) await deleteAction.run();
  };

  const statusLabel =
    draft.statusKey === "saved" && draft.savedAt
      ? tr("folios.editor.status.saved", {
          args: [String(dt.of(draft.savedAt).fromNow())],
        })
      : tr(`folios.editor.status.${draft.statusKey}`);

  return (
    <div className="bg-card flex h-full min-h-0 flex-col overflow-hidden">
      {/* Chrome rows — the menubar and toolbar mount here in Task 10,
          rendered through MDXEditor's `renderToolbar`. */}
      <div className="border-border flex h-13 flex-none items-center gap-2 border-b px-3">
        <div className="flex-1" />
        <span className="text-muted-foreground folio-mono text-xs">
          {statusLabel}
        </span>
        <Button
          size="sm"
          onClick={() => saveAction.run()}
          disabled={saveAction.loading || isProtected}
        >
          <Save className="size-4" />
          {tr("folios.editor.action.save")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Tree pane — Task 9 */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[812px] flex-col gap-4 px-8 py-8">
            <Control
              input={draft.form.input.title}
              placeholder={tr("folios.title-placeholder")}
              disabled={isProtected}
            />
            <ControlSelect
              input={draft.form.input.tags}
              combobox
              createNewEntry
              disabled={isProtected}
              items={tags.map((tag) => ({ value: tag, label: tag }))}
            />
            {isProtected && props.folio ? (
              <FolioProtectedView
                folio={props.folio}
                onDeleteUnrecoverable={handleDeleteUnrecoverable}
              />
            ) : (
              <MarkdownEditor
                value={draft.values.content}
                onChange={(v) => draft.form.input.content.set(v)}
                placeholder={tr("folios.content-placeholder")}
                imageUploadHandler={imageUploadHandler}
                minHeight={420}
              />
            )}
          </div>
        </div>
        {/* Inspector pane — Task 10 */}
      </div>
    </div>
  );
};

export default FolioWorkspaceContent;
