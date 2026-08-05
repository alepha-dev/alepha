import { Control } from "@alepha/ui/components/control/control";
import { ControlSelect } from "@alepha/ui/components/control-select/control-select";
import { Button } from "@alepha/ui/components/ui/button";
import { z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useForm, useFormState, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ArrowLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentFolioAtom } from "../../atoms/currentFolioAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { folioTagsAtom } from "../../atoms/folioTagsAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import MarkdownEditor from "../shared/markdown-editor/MarkdownEditor.tsx";
import { useFolioImageUpload } from "../shared/markdown-editor/useFolioImageUpload.ts";
import {
  forgetProtectedKey,
  getProtectedKey,
  rememberProtectedKey,
} from "./protectedFolioKeys.ts";

interface FolioEditorProps {
  /**
   * `undefined` → create mode. `Folio` → edit mode (initial values pre-filled,
   * save calls `update` instead of `create`).
   */
  folio?: Folio;
  /**
   * Create-mode only: seed the new folio's `directoryId` so it lands in
   * the directory the user clicked "+ Create → New folio" from. Ignored
   * in edit mode.
   */
  directoryId?: string;
}

const folioFormSchema = z.object({
  title: z.string().max(200).meta({ title: "Title" }),
  tags: z
    .array(z.string())
    .meta({ title: "Tags" })
    .describe(
      "Press Enter or comma to add a tag. Reuse existing ones when you can.",
    ),
  content: z
    .string()
    .meta({ title: "Content" })
    .describe("Markdown is rendered when viewing.")
    .default(""),
});

const FolioEditor = (props: FolioEditorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const folioApi = useClient<FolioController>();
  const [folios, setFolios] = useStore(userFoliosAtom);
  const [tags, setTags] = useStore(folioTagsAtom);
  const [project] = useStore(currentProjectAtom);
  const projectId = project ? String(project.id) : "";

  const isEdit = !!props.folio;
  const crypto = useInject(CryptoProvider);

  // Image uploads land in the project Folio as blobs — disabled on
  // protected folios (the bytes would sit unencrypted next to encrypted
  // content).
  const imageUploadHandler = useFolioImageUpload(
    project?.id,
    !props.folio?.protected,
  );

  // Encryption is no longer chosen at create time. A clear folio is
  // encrypted from the view (FolioView → FolioPassphraseDialog). The
  // editor only re-encrypts an already-protected folio on save, reusing
  // the session key the user established by unlocking it in the view.
  const [protectError, setProtectError] = useState<string | null>(null);

  // Pre-fill the editor with the *decrypted* content when editing a
  // protected folio (assumes the user already unlocked it via the view).
  // Falls back to empty if the cache was cleared — they'll have to
  // re-enter the passphrase below to save.
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);

  useEffect(() => {
    if (!props.folio?.protected) return;
    const cached = getProtectedKey(props.folio.id);
    if (!cached) return;
    let alive = true;
    (async () => {
      try {
        const env = JSON.parse(props.folio?.content ?? "{}") as {
          iv: string;
          ciphertext: string;
        };
        const ivBytes = new Uint8Array(env.iv.length / 2);
        for (let i = 0; i < env.iv.length; i += 2) {
          ivBytes[i / 2] = Number.parseInt(env.iv.substring(i, i + 2), 16);
        }
        const ctBytes = new Uint8Array(env.ciphertext.length / 2);
        for (let i = 0; i < env.ciphertext.length; i += 2) {
          ctBytes[i / 2] = Number.parseInt(
            env.ciphertext.substring(i, i + 2),
            16,
          );
        }
        const decrypted = await window.crypto.subtle.decrypt(
          { name: "AES-GCM", iv: ivBytes.buffer as ArrayBuffer },
          cached,
          ctBytes.buffer as ArrayBuffer,
        );
        if (alive) {
          const text = new TextDecoder().decode(decrypted);
          setDecryptedContent(text);
          form.input.content.set(text);
        }
      } catch {
        // Stale cached key — let the save path re-prompt for passphrase.
        forgetProtectedKey(props.folio?.id ?? "");
      }
    })();
    return () => {
      alive = false;
    };
    // form is stable; props.folio.id/content fully drive this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.folio?.id]);

  const form = useForm({
    id: isEdit ? `folio-${props.folio?.id}` : "folio-new",
    schema: folioFormSchema,
    initialValues: {
      title: props.folio?.title ?? "",
      tags: props.folio?.tags ?? [],
      // Show empty content for a protected folio until the user unlocks
      // it here too. Otherwise the textarea would display ciphertext.
      content: props.folio?.protected
        ? (decryptedContent ?? "")
        : (props.folio?.content ?? ""),
    },
    handler: async (data) => {
      // Re-encrypt an already-protected folio client-side before the
      // request leaves the tab (the server only ever sees ciphertext).
      // Encryption reuses the session key the user established by
      // unlocking the folio in the view; without it we can't re-encrypt,
      // so block the save and point them back to the view to unlock.
      const isProtected = !!props.folio?.protected;
      let contentToSend = data.content;
      if (isProtected && props.folio) {
        const cachedKey = getProtectedKey(props.folio.id);
        if (!cachedKey) {
          setProtectError(tr("folios.protected.unlock-before-edit"));
          return;
        }
        const existingEnv = JSON.parse(props.folio.content ?? "{}") as {
          salt?: string;
        };
        const saltHex = existingEnv.salt ?? "";
        if (!saltHex) {
          setProtectError(tr("folios.protected.invalid-envelope"));
          return;
        }
        contentToSend = await crypto.encryptWithPassphrase(
          data.content,
          cachedKey,
          saltHex,
        );
        rememberProtectedKey(props.folio.id, cachedKey);
      }

      const saved =
        isEdit && props.folio
          ? await folioApi.update({
              params: { id: props.folio.id },
              body: {
                ...data,
                content: contentToSend,
                protected: isProtected,
              },
            })
          : await folioApi.create({
              body: {
                ...data,
                content: contentToSend,
                protected: false,
                // A folio is always created within the active project.
                projectId: project!.id,
                directoryId: props.directoryId,
              },
            });

      // Update sidebar list
      const next = isEdit
        ? folios.map((f) => (f.id === saved.id ? saved : f))
        : [saved, ...folios];
      setFolios(next);

      // Refresh tag list (union of new tags)
      const merged = new Set<string>(tags);
      for (const t of saved.tags) merged.add(t);
      setTags([...merged].sort());

      alepha.store.set(currentFolioAtom, saved);

      await router.push(
        router.path("projectFoliosFolio", {
          params: { projectId, shortId: saved.shortId },
        }),
      );
    },
  });

  const { loading: submitting } = useFormState(form, ["loading"]);

  const handleBack = async () => {
    if (isEdit && props.folio) {
      await router.push(
        router.path("projectFoliosFolio", {
          params: { projectId, id: props.folio.id },
        }),
      );
    } else {
      await router.push(
        router.path("projectFolios", { params: { projectId } }),
      );
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label={tr("folios.back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="flex-1 text-xl font-semibold">
          {isEdit ? tr("folios.edit-folio") : tr("folios.new-folio")}
        </h1>
        <Button type="submit" form={form.props.id} disabled={submitting}>
          <Save className="size-4" />
          {tr("folios.save")}
        </Button>
      </div>

      <form {...form.props} className="flex flex-col gap-4">
        <Control
          input={form.input.title}
          placeholder={tr("folios.title-placeholder")}
        />
        <ControlSelect
          input={form.input.tags}
          combobox
          createNewEntry
          items={tags.map((tag) => ({ value: tag, label: tag }))}
        />
        {/* Folio nesting under other folios was removed by quest #66 —
            folios live in folio directories now. The directory picker
            lives in the new Folio UI. Encryption moved to the view
            (FolioView's Encrypt action); the editor only shows save-time
            re-encryption errors for an already-protected folio. */}
        {protectError && (
          <p className="text-destructive text-xs" role="alert">
            {protectError}
          </p>
        )}

        <FolioContentField
          form={form}
          placeholder={tr("folios.content-placeholder")}
          imageUploadHandler={imageUploadHandler}
        />

        {props.folio?.pinned && (
          <TokenEstimator
            form={form}
            folioId={props.folio.id}
            pinnedFolios={folios.filter((f) => f.pinned && !f.protected)}
          />
        )}
      </form>
    </div>
  );
};

/**
 * The folio body, edited as markdown through the shared WYSIWYG editor.
 * Wired to the form manually (rather than through `Control custom`) so
 * the per-folio image upload handler can be passed down.
 */
const FolioContentField = (props: {
  form: ReturnType<typeof useForm<typeof folioFormSchema>>;
  placeholder: string;
  imageUploadHandler?: (file: File) => Promise<string>;
}) => {
  const values = useFormValues(props.form);

  return (
    <MarkdownEditor
      value={(values.content as string) ?? ""}
      onChange={(v) => props.form.input.content.set(v)}
      placeholder={props.placeholder}
      imageUploadHandler={props.imageUploadHandler}
      minHeight={420}
    />
  );
};

/**
 * Small badge under the content textarea showing the approximate token
 * cost of this folio's content, plus a warning when the project's pinned
 * total would exceed the 8K-char cap used by `project_context`. Only
 * rendered for pinned, non-protected folios — the cap doesn't apply
 * elsewhere.
 *
 * Estimation heuristic: `Math.ceil(content.length / 4)`. Cheap and
 * close enough — the precise tokenizer lives server-side and isn't
 * worth shipping client-side just for a hint.
 */
const PINNED_CAP_CHARS = 8192;

const TokenEstimator = (props: {
  form: ReturnType<typeof useForm<typeof folioFormSchema>>;
  folioId: string;
  pinnedFolios: Folio[];
}) => {
  const { tr } = useI18n<I18n, "en">();
  const values = useFormValues(props.form);
  const ownContent = (values.content as string) ?? "";
  const ownChars = ownContent.length;
  const otherChars = props.pinnedFolios
    .filter((f) => f.id !== props.folioId)
    .reduce((sum, f) => sum + f.content.length, 0);
  const totalChars = ownChars + otherChars;
  const overCap = totalChars > PINNED_CAP_CHARS;
  const tokens = Math.ceil(ownChars / 4);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className={overCap ? "text-amber-600" : "text-muted-foreground"}>
        {tr("folios.token-estimate", { args: [String(tokens)] })}
      </span>
      {overCap && (
        <span className="text-amber-600" role="alert">
          {tr("folios.pin-cap-warning")}
        </span>
      )}
    </div>
  );
};

export default FolioEditor;
