import { Control } from "@alepha/ui/components/control/control";
import { ControlSelect } from "@alepha/ui/components/control-select/control-select";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { Switch } from "@alepha/ui/components/ui/switch";
import { t } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ArrowLeft, Lock, Save, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentFolioAtom } from "../../atoms/currentFolioAtom.ts";
import { folioTagsAtom } from "../../atoms/folioTagsAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../services/I18n.ts";
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
}

const folioFormSchema = t.object({
  title: t.string({
    maxLength: 200,
    title: "Title",
  }),
  tags: t.array(t.string(), {
    title: "Tags",
    description:
      "Press Enter or comma to add a tag. Reuse existing ones when you can.",
  }),
  parentId: t.optional(
    t.string({
      title: "Parent folio",
      description:
        "Nest this folio under another one. Leave empty to keep it at the root of the sidebar.",
    }),
  ),
  content: t.string({
    title: "Content",
    description: "Markdown is rendered when viewing.",
    default: "",
  }),
});

const FolioEditor = (props: FolioEditorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const folioApi = useClient<FolioController>();
  const [folios, setFolios] = useStore(userFoliosAtom);
  const [tags, setTags] = useStore(folioTagsAtom);
  const [campaign] = useStore(currentCampaignAtom);
  const campaignId = campaign ? String(campaign.id) : "";

  const isEdit = !!props.folio;
  const crypto = useInject(CryptoProvider);

  // Protected flow: on create, the user opts in via the switch and types
  // a passphrase twice. On edit of an existing protected folio, we reuse
  // the cached session key from `FolioProtectedView` (the user already
  // unlocked it to read); if no key is cached yet we ask for the
  // passphrase right here before saving.
  const [protectedMode, setProtectedMode] = useState(!!props.folio?.protected);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [protectError, setProtectError] = useState<string | null>(null);

  // The `useForm` handler is memoized at form-creation time, so its
  // closure captures the *initial* protectedMode / passphrase values
  // (both falsy). Mirror the live state into refs so the submit path
  // sees the user's actual choice. Same pattern as the Turnstile token
  // in `auth-register.tsx`.
  const protectedModeRef = useRef(protectedMode);
  const passphraseRef = useRef(passphrase);
  const passphraseConfirmRef = useRef(passphraseConfirm);
  useEffect(() => {
    protectedModeRef.current = protectedMode;
  }, [protectedMode]);
  useEffect(() => {
    passphraseRef.current = passphrase;
  }, [passphrase]);
  useEffect(() => {
    passphraseConfirmRef.current = passphraseConfirm;
  }, [passphraseConfirm]);

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
      parentId: props.folio?.parentId,
      // Show empty content for a protected folio until the user unlocks
      // it here too. Otherwise the textarea would display ciphertext.
      content: props.folio?.protected
        ? (decryptedContent ?? "")
        : (props.folio?.content ?? ""),
    },
    handler: async (data) => {
      // Empty string from the picker means "no parent" — translate before
      // sending so the controller treats it as a root move, not a missing
      // FK lookup.
      const parentId = data.parentId === "" ? null : data.parentId;

      // Protected-mode encryption happens client-side before the request
      // leaves the tab. The server only ever sees ciphertext.
      const liveProtectedMode = protectedModeRef.current;
      const livePassphrase = passphraseRef.current;
      const livePassphraseConfirm = passphraseConfirmRef.current;
      let contentToSend = data.content;
      if (liveProtectedMode) {
        if (!isEdit) {
          if (!livePassphrase || livePassphrase !== livePassphraseConfirm) {
            setProtectError(String(tr("folios.protected.passphrase-mismatch")));
            return;
          }
          if (livePassphrase.length < 8) {
            setProtectError(String(tr("folios.protected.passphrase-weak")));
            return;
          }
        }
        const cachedKey = props.folio
          ? getProtectedKey(props.folio.id)
          : undefined;
        // For create: fresh salt + derive. For edit with cached key:
        // reuse it (same passphrase as the existing envelope). For edit
        // WITHOUT cache: require the user to re-type the passphrase
        // here.
        let key: CryptoKey;
        let saltHex: string;
        if (!isEdit) {
          // 128-bit salt: UUID v4 yields 32 hex chars after stripping
          // dashes. Sync, sufficient entropy for PBKDF2.
          saltHex = crypto.randomUUID().replace(/-/g, "");
          key = await crypto.deriveKeyFromPassphrase(livePassphrase, saltHex);
        } else if (cachedKey) {
          const existingEnv = JSON.parse(props.folio?.content ?? "{}") as {
            salt?: string;
          };
          saltHex = existingEnv.salt ?? "";
          if (!saltHex) {
            setProtectError(String(tr("folios.protected.invalid-envelope")));
            return;
          }
          key = cachedKey;
        } else {
          if (!livePassphrase) {
            setProtectError(
              String(tr("folios.protected.passphrase-required-for-save")),
            );
            return;
          }
          const existingEnv = JSON.parse(props.folio?.content ?? "{}") as {
            salt?: string;
          };
          saltHex = existingEnv.salt ?? "";
          if (!saltHex) {
            setProtectError(String(tr("folios.protected.invalid-envelope")));
            return;
          }
          key = await crypto.deriveKeyFromPassphrase(livePassphrase, saltHex);
        }
        contentToSend = await crypto.encryptWithPassphrase(
          data.content,
          key,
          saltHex,
        );
        if (props.folio) rememberProtectedKey(props.folio.id, key);
      }

      const saved =
        isEdit && props.folio
          ? await folioApi.update({
              params: { id: props.folio.id },
              body: {
                ...data,
                content: contentToSend,
                protected: liveProtectedMode,
                parentId,
              },
            })
          : await folioApi.create({
              body: {
                ...data,
                content: contentToSend,
                protected: liveProtectedMode,
                parentId,
                campaignId: campaign?.id,
              },
            });

      // Clear the typed passphrase from component state — it stays in
      // the derived key (intentional, cached for the session) but the
      // raw string shouldn't linger longer than it has to.
      setPassphrase("");
      setPassphraseConfirm("");

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
        router.path("campaignFoliosFolio", {
          params: { campaignId, shortId: saved.shortId },
        }),
      );
    },
  });

  const handleBack = async () => {
    if (isEdit && props.folio) {
      await router.push(
        router.path("campaignFoliosFolio", {
          params: { campaignId, id: props.folio.id },
        }),
      );
    } else {
      await router.push(
        router.path("campaignFolios", { params: { campaignId } }),
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
          aria-label={String(tr("folios.back"))}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="flex-1 text-xl font-semibold">
          {isEdit ? tr("folios.edit-folio") : tr("folios.new-folio")}
        </h1>
        <Button type="submit" form={form.props.id} disabled={form.submitting}>
          <Save className="size-4" />
          {tr("folios.save")}
        </Button>
      </div>

      <form {...form.props} className="flex flex-col gap-4">
        <Control
          input={form.input.title}
          placeholder={String(tr("folios.title-placeholder"))}
        />
        <ControlSelect
          input={form.input.tags}
          combobox
          createNewEntry
          items={tags.map((tag) => ({ value: tag, label: tag }))}
        />
        <ControlSelect
          input={form.input.parentId}
          combobox
          items={folios
            .filter((f) => f.id !== props.folio?.id)
            .map((f) => ({ value: f.id, label: f.title }))}
        />

        {/* Protect-this-folio switch. Disabled in edit mode if the
            cached session key is missing — toggling to non-protected on
            an encrypted folio would commit ciphertext as plaintext. */}
        <div className="bg-card border-border flex flex-col gap-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-1 items-start gap-2">
              {protectedMode ? (
                <ShieldCheck className="mt-0.5 size-4 text-emerald-500" />
              ) : (
                <Lock className="text-muted-foreground mt-0.5 size-4" />
              )}
              <div className="flex flex-col">
                <Label className="text-sm font-medium">
                  {tr("folios.protected.toggle-label")}
                </Label>
                <span className="text-muted-foreground text-xs">
                  {tr("folios.protected.toggle-helper")}
                </span>
              </div>
            </div>
            <Switch
              checked={protectedMode}
              onCheckedChange={(v: boolean) => {
                setProtectedMode(v);
                setProtectError(null);
              }}
              disabled={isEdit}
              aria-label={String(tr("folios.protected.toggle-label"))}
            />
          </div>
          {protectedMode && !isEdit && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="folio-passphrase" className="text-xs">
                  {tr("folios.protected.passphrase")}
                </Label>
                <Input
                  id="folio-passphrase"
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.currentTarget.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="folio-passphrase-confirm" className="text-xs">
                  {tr("folios.protected.passphrase-confirm")}
                </Label>
                <Input
                  id="folio-passphrase-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={passphraseConfirm}
                  onChange={(e) => setPassphraseConfirm(e.currentTarget.value)}
                />
              </div>
              <p className="text-muted-foreground text-xs italic">
                {tr("folios.protected.create-warning")}
              </p>
            </>
          )}
          {protectError && (
            <p className="text-destructive text-xs" role="alert">
              {protectError}
            </p>
          )}
        </div>

        <Control
          input={form.input.content}
          area
          placeholder={String(tr("folios.content-placeholder"))}
        />
      </form>
    </div>
  );
};

export default FolioEditor;
