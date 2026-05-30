import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { t } from "alepha";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { ImageIcon, Loader2, Paperclip, UserCircle2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { displayName } from "../../../services/displayName.ts";
import { publicFileUrl } from "../../../services/fileUrl.ts";
import type { I18n } from "../../../services/I18n.ts";
import PageHeader from "../../shared/header/PageHeader.tsx";

const DRAFT_STORAGE_KEY = "lor.petition.draft";
const MAX_FILES = 10;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 100;

/**
 * Sigil-popup provenance carried in the draft. When `sigilId` is present the
 * request form runs in "sigil popup mode": it ran a `postMessage` handshake
 * with the opener, posts a `source` block on submit, then messages the opener
 * back and closes itself.
 */
type SigilContext = {
  sigilId?: string;
  hostUrl?: string;
  hostPath?: string;
};

type DraftContext = {
  tags?: string[];
  sigil?: SigilContext;
};

type Attachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
};

type CampaignContext = {
  title: string;
  icon?: string | null;
};

const readDraftFromQuery = (query: URLSearchParams): DraftContext => {
  const tags = query
    .getAll("tags")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= MAX_TAG_LENGTH)
    .slice(0, MAX_TAGS);

  // The embed launcher sends `type=bug|feature` — fold it into the tag set
  // (petitions have no first-class type column; tags carry the taxonomy).
  const typeParam = query.get("type")?.trim().toLowerCase();
  if (
    (typeParam === "bug" || typeParam === "feature") &&
    !tags.includes(typeParam)
  ) {
    tags.unshift(typeParam);
  }

  const sigilId = query.get("sigil")?.trim();
  const draft: DraftContext = {};
  if (tags.length > 0) draft.tags = tags;
  if (sigilId) {
    // `url`/`path` are the embedding page's URL — folded into the source
    // block (and shown to the campaign owner) verbatim.
    draft.sigil = {
      sigilId: sigilId.slice(0, 100),
      hostUrl: (query.get("url") ?? "").slice(0, 2000) || undefined,
      hostPath: (query.get("path") ?? "").slice(0, 2000) || undefined,
    };
  }
  return draft;
};

/** Convert a `data:` URL to a `File` so the screenshot rides as an attachment. */
const dataUrlToFile = (dataUrl: string, name: string): File | null => {
  try {
    const [header, b64] = dataUrl.split(",");
    if (!header || !b64) return null;
    const mime = /:(.*?);/.exec(header)?.[1] ?? "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: mime });
  } catch {
    return null;
  }
};

/**
 * Pull tag prefill from the URL into sessionStorage as soon as the page
 * mounts, then clean the URL via `history.replaceState`. Keeping the data in
 * sessionStorage (rather than the URL or localStorage) means: (a) it survives
 * the Google login redirect on the same tab, (b) it doesn't leak through
 * browser history or server logs, (c) it's automatically scoped to this tab
 * and cleared when the tab closes.
 */
const useDraftAutofill = (campaignId: string) => {
  const key = `${DRAFT_STORAGE_KEY}.${campaignId}`;
  const [draft, setDraft] = useState<DraftContext>({});

  useEffect(() => {
    if (typeof window === "undefined") return;

    const query = new URLSearchParams(window.location.search);
    const fromQuery = readDraftFromQuery(query);

    if (Object.keys(fromQuery).length > 0) {
      window.sessionStorage.setItem(key, JSON.stringify(fromQuery));
      const cleanUrl = `${window.location.pathname}${window.location.hash}`;
      window.history.replaceState(null, "", cleanUrl);
      setDraft(fromQuery);
      return;
    }

    const stored = window.sessionStorage.getItem(key);
    if (stored) {
      try {
        setDraft(JSON.parse(stored) as DraftContext);
      } catch {
        // ignore corrupt draft
      }
    }
  }, [key]);

  const clear = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(key);
    }
  };

  return { draft, clear };
};

const CampaignPetitionRequest = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const auth = useAuth();
  const petitionApi = useClient<PetitionController>();
  const toaster = useToast();

  const routerState = useRouterState();
  const campaignIdParam = String(routerState.params.campaignId);
  const campaignId = Number(campaignIdParam);

  const { draft, clear: clearDraft } = useDraftAutofill(campaignIdParam);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // Tags are an internal triage taxonomy — never typed by the reporter.
  // They are seeded from query params (a "Feedback" button opening
  // `/request?tags=bug`) and kept in state only to ride along on submit.
  const [tags, setTags] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sigil-popup mode: a preview of the screenshot the opener captured, and
  // the console tail it forwarded. Both ride into the petition on submit.
  const sigil = draft.sigil;
  const isSigilMode = Boolean(sigil?.sigilId);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [consoleTail, setConsoleTail] = useState<string[]>([]);

  // The submit handler is closed over by `FormModel` at first render (the
  // `useForm` `FormModel` is built once via `useMemo([])` — passing non-empty
  // `deps` would rebuild the model and wipe user-typed values). At first
  // render the sigil draft, screenshot, console tail, attachments and tags
  // are all still empty — they are populated asynchronously by effects.
  // To let the frozen handler see live values, mirror everything it needs
  // into a ref that is refreshed on every render.
  const liveRef = useRef({
    isSigilMode,
    sigil,
    screenshot,
    consoleTail,
    attachments,
    tags,
  });
  liveRef.current = {
    isSigilMode,
    sigil,
    screenshot,
    consoleTail,
    attachments,
    tags,
  };

  useEffect(() => {
    if (draft.tags && draft.tags.length > 0) {
      setTags(draft.tags);
    }
  }, [draft.tags]);

  // Fetch minimal campaign info to show "submitting to X" on the form. This
  // page is a top-level route with no campaign data; the endpoint is gated
  // like `submitPetition` (any logged-in user, petitions feature on). A
  // failed/pending fetch just hides the campaign side — never breaks the form.
  const [campaign, setCampaign] = useState<CampaignContext | null>(null);
  useEffect(() => {
    if (!auth.user || !Number.isFinite(campaignId)) return;
    let cancelled = false;
    petitionApi
      .petitionContext({ params: { campaignId } })
      .then((res) => {
        if (!cancelled) setCampaign(res);
      })
      .catch(() => {
        if (!cancelled) setCampaign(null);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user, campaignId]);

  // postMessage handshake with the sigil opener (the embedding page). We
  // announce readiness and accept exactly one `lore.sigil.payload` message —
  // ORIGIN-CHECKED against the embedding page's origin. The screenshot/console
  // tail are attacker-controlled; treated as opaque data, never executed.
  //
  // FAIL CLOSED: the trusted origin is derived from the `?url=` param, which
  // is supplied by the *embedding page itself* (forwarded verbatim by the
  // sigil redirect — see `SigilEmbedController.getRequestPage`). The sigil's
  // authoritative server-side `allowedOrigins` array is NOT available to this
  // SPA page (the redirect forwards only `path`/`url`/`type`, and exposing it
  // would mean a new public endpoint — out of scope). So `?url=` is the only
  // origin signal we have. If it is missing or unparseable we CANNOT identify
  // a trusted origin: in that case we must NOT run the handshake at all —
  // never post `lore.sigil.ready` (which would advertise this popup to any
  // window via `"*"`) and never accept an inbound payload (which would let
  // ANY origin inject an attacker-controlled `screenshot`/`consoleTail`).
  // The form still works as a normal petition form; only the screenshot /
  // console-tail pre-fill is skipped (graceful degradation).
  useEffect(() => {
    if (!isSigilMode || !auth.user) return;
    if (typeof window === "undefined" || !window.opener) return;

    const hostUrl = sigil?.hostUrl;
    let allowedOrigin: string | null = null;
    if (hostUrl) {
      try {
        allowedOrigin = new URL(hostUrl).origin;
      } catch {
        allowedOrigin = null;
      }
    }

    // No trusted origin → fail closed: skip the entire sigil handshake.
    // Do not register the listener and do not announce readiness.
    if (!allowedOrigin) return;
    const trustedOrigin = allowedOrigin;

    const onMessage = (event: MessageEvent) => {
      // Only trust messages from the embedding page's own origin.
      if (event.origin !== trustedOrigin) return;
      const data = event.data as
        | { type?: string; screenshot?: unknown; consoleTail?: unknown }
        | undefined;
      if (!data || data.type !== "lore.sigil.payload") return;

      if (typeof data.screenshot === "string") {
        setScreenshot(data.screenshot);
      }
      if (Array.isArray(data.consoleTail)) {
        setConsoleTail(
          data.consoleTail
            .filter((v): v is string => typeof v === "string")
            .slice(0, 50)
            .map((v) => v.slice(0, 2000)),
        );
      }
    };

    window.addEventListener("message", onMessage);
    // Tell the opener we're mounted and ready to receive the payload —
    // targeted at the trusted origin only, never `"*"`.
    window.opener.postMessage(
      { type: "lore.sigil.ready", sigilId: sigil?.sigilId },
      trustedOrigin,
    );

    return () => window.removeEventListener("message", onMessage);
  }, [isSigilMode, auth.user, sigil?.sigilId, sigil?.hostUrl]);

  // One free-text field. Client schema stays looser than the server's — a
  // `minLength` here would fail TypeBox at form-construction time (empty
  // initial value). The server (`petitionBodySchema`) enforces real bounds.
  const form = useForm({
    schema: t.object({
      message: t.string({ maxLength: 10_000 }),
    }),
    initialValues: { message: "" },
    handler: async (body) => {
      // Read live state through the ref — the handler closure itself is
      // frozen at first render, when these were all still empty.
      const { isSigilMode, sigil, screenshot, consoleTail, attachments, tags } =
        liveRef.current;
      try {
        const attachmentIds = attachments.map((a) => a.id);

        // In sigil mode the screenshot rides along as one more attachment:
        // upload it now (the user already saw + could remove the preview).
        if (isSigilMode && screenshot) {
          const file = dataUrlToFile(
            screenshot,
            `sigil-screenshot-${Date.now()}.png`,
          );
          if (file && attachmentIds.length < MAX_FILES) {
            try {
              const up = await petitionApi.uploadPetitionAttachment({
                params: { campaignId },
                body: { file },
              });
              attachmentIds.push(up.id);
            } catch {
              // A failed screenshot upload must not block the petition.
            }
          }
        }

        const source =
          isSigilMode && sigil?.sigilId
            ? {
                sigilId: sigil.sigilId,
                hostUrl: sigil.hostUrl ?? "",
                hostPath: sigil.hostPath ?? "",
                userAgent:
                  typeof navigator !== "undefined"
                    ? navigator.userAgent.slice(0, 1000)
                    : "",
                consoleTail: consoleTail.length > 0 ? consoleTail : undefined,
              }
            : undefined;

        // The reporter writes one free-text blob. Derive a short title from
        // its first non-empty line so the owner's triage inbox has a
        // per-row label; `description` keeps the full text.
        const message = body.message.trim();
        const firstLine =
          message
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? message;

        const { id } = await petitionApi.submitPetition({
          params: { campaignId },
          body: {
            title: firstLine.slice(0, 120),
            description: message,
            attachments: attachmentIds,
            // Fall back to a generic tag so nothing lands untagged in the
            // triage inbox when the form is opened without query params.
            tags: tags.length > 0 ? tags : ["feedback"],
            source,
          },
        });
        clearDraft();
        toaster.show(tr("petitions.request.success"), "success");

        // Sigil popup: tell the embedding page it succeeded, then close —
        // the host bundle shows the "Thanks!" toast.
        if (isSigilMode && typeof window !== "undefined" && window.opener) {
          // Fail closed (same threat as the handshake effect above): the
          // target origin comes from the embedding-page-controlled `?url=`
          // param. If it is missing/unparseable we cannot identify a trusted
          // origin, so we do NOT broadcast the notification to `"*"` — we
          // simply skip it and close. The petition is already saved.
          let target: string | null = null;
          try {
            if (sigil?.hostUrl) target = new URL(sigil.hostUrl).origin;
          } catch {
            target = null;
          }
          if (target) {
            window.opener.postMessage(
              { type: "lore.sigil.submitted", sigilId: sigil?.sigilId },
              target,
            );
          }
          window.close();
          return;
        }

        await router.push("campaignPetitionStatus", {
          params: {
            campaignId: campaignIdParam,
            petitionId: String(id),
          },
        });
      } catch (err: any) {
        toaster.show(err?.message ?? tr("petitions.request.error"), "danger");
      }
    },
  });

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (attachments.length + files.length > MAX_FILES) {
      toaster.show(
        String(
          tr("petitions.request.tooManyFiles", { args: [String(MAX_FILES)] }),
        ),
        "danger",
      );
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        try {
          const result = await petitionApi.uploadPetitionAttachment({
            params: { campaignId },
            body: { file },
          });
          setAttachments((prev) => [...prev, result]);
        } catch (err: any) {
          toaster.show(
            err?.message ?? tr("petitions.request.uploadError"),
            "danger",
          );
        }
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onFilePicked = (files: FileList | null) => {
    if (!files) return;
    void uploadFiles(Array.from(files));
  };

  // Ctrl+V / Cmd+V on the page uploads any pasted image (e.g. screenshots).
  // Bound to window so the user doesn't have to focus a specific element.
  useEffect(() => {
    if (!auth.user) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            // Browsers paste images as "image.png" — disambiguate so the
            // filename is unique per paste (the server enforces extension
            // whitelist; we just give it something readable).
            const ext = file.name.includes(".")
              ? file.name.slice(file.name.lastIndexOf("."))
              : ".png";
            const named = new File([file], `pasted-${Date.now()}${ext}`, {
              type: file.type,
            });
            pasted.push(named);
          }
        }
      }
      if (pasted.length > 0) {
        e.preventDefault();
        void uploadFiles(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [auth.user, attachments.length, campaignId]);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  if (!auth.user) {
    // Anonymous: invite to log in. The draft was already persisted to
    // sessionStorage on mount, so it survives the round-trip through Google.
    return (
      <>
        <PageHeader />
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pt-16">
          <Card className="shadow">
            <CardContent className="flex flex-col gap-4">
              <h1 className="text-xl font-semibold">
                {tr("petitions.request.loginRequiredTitle")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {tr("petitions.request.loginRequiredBody")}
              </p>
              <Button
                onClick={() =>
                  router.push("login", {
                    query: { r: window.location.pathname },
                  })
                }
              >
                {tr("petitions.request.signIn")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const userLabel = displayName(auth.user, "");
  const userPicture = (auth.user as any).picture as string | undefined;

  return (
    <>
      <PageHeader />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pt-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">{tr("petitions.request.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {tr("petitions.request.description")}
          </p>
        </div>

        <Card className="py-4 shadow">
          <CardContent className="px-4">
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                {userPicture ? (
                  <img
                    alt=""
                    src={publicFileUrl(userPicture)}
                    className="size-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <UserCircle2 className="size-8 shrink-0 text-muted-foreground" />
                )}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {userLabel}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {tr("petitions.request.submittingAs")}
                  </span>
                </div>
              </div>

              {campaign && (
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex min-w-0 flex-col items-end text-right">
                    <span className="truncate text-sm font-medium">
                      {campaign.title}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {tr("petitions.request.forCampaign")}
                    </span>
                  </div>
                  <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
                    {campaign.icon ? (
                      <img
                        alt=""
                        src={publicFileUrl(campaign.icon)}
                        className="size-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="size-4" />
                    )}
                  </div>
                </div>
              )}
            </div>

            <form {...form.props} className="flex flex-col gap-4">
              {/* Single free-text field. It doubles as a paste/drop target
                  for screenshots — global paste works regardless of focus,
                  this just makes dragging files discoverable. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: file-attachment drop zone — the textarea inside is the real control, drag handlers are a progressive enhancement */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  onFilePicked(e.dataTransfer.files);
                }}
                className={`flex flex-col gap-1 rounded-md ${
                  dragging ? "ring-2 ring-primary ring-offset-2" : ""
                }`}
              >
                <Control
                  input={form.input.message}
                  label={tr("petitions.request.messageField")}
                  description={tr("petitions.request.messageHelper")}
                  area
                  autoFocus
                  rows={12}
                />
                <p className="text-muted-foreground text-xs">
                  {tr("petitions.request.pasteHint")}
                </p>
              </div>

              {isSigilMode && screenshot && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    {tr("petitions.request.screenshot")}
                  </label>
                  <p className="text-muted-foreground text-xs">
                    {tr("petitions.request.screenshotHelper")}
                  </p>
                  <div className="relative w-fit">
                    <img
                      alt={tr("petitions.request.screenshot")}
                      src={screenshot}
                      className="max-h-48 rounded border border-border object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setScreenshot(null)}
                      aria-label={String(
                        tr("petitions.request.screenshotRemove"),
                      )}
                      className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  {tr("petitions.request.attachments")}
                </label>
                <p className="text-muted-foreground text-xs">
                  {tr("petitions.request.attachmentsHelper")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => onFilePicked(e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading || attachments.length >= MAX_FILES}
                    onClick={() => inputRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                    {tr("petitions.request.attach")}
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    {tr("petitions.request.attachmentsCount", {
                      args: [String(attachments.length), String(MAX_FILES)],
                    })}
                  </span>
                </div>
                {attachments.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {attachments.map((a) => {
                      const isImage = a.mimeType?.startsWith("image/");
                      return (
                        <li
                          key={a.id}
                          className="flex items-center gap-2 rounded border border-border bg-muted/20 px-2 py-1 text-sm"
                        >
                          {isImage ? (
                            <img
                              alt=""
                              src={`/api/files/${a.id}`}
                              className="size-10 shrink-0 rounded border border-border object-cover"
                            />
                          ) : (
                            <Paperclip className="size-3.5 shrink-0" />
                          )}
                          <span className="truncate flex-1">{a.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {Math.round(a.size / 1024)} KB
                          </span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(a.id)}
                            className="hover:text-foreground text-muted-foreground"
                            aria-label="remove"
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    router.push("campaign", {
                      params: { campaignId: campaignIdParam },
                    })
                  }
                  disabled={form.submitting}
                >
                  {tr("petitions.request.cancel")}
                </Button>
                <Button type="submit" disabled={form.submitting || uploading}>
                  {form.submitting && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {tr("petitions.request.submit")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default CampaignPetitionRequest;
