import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { t } from "alepha";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { Loader2, Paperclip, UserCircle2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { displayName } from "../../../services/displayName.ts";
import type { I18n } from "../../../services/I18n.ts";
import { Toaster } from "../../../services/Toaster.ts";
import PageHeader from "../../shared/header/PageHeader.tsx";

const DRAFT_STORAGE_KEY = "lor.petition.draft";
const MAX_FILES = 10;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 100;

type DraftContext = {
  tags?: string[];
};

type Attachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
};

const readDraftFromQuery = (query: URLSearchParams): DraftContext => {
  const tags = query
    .getAll("tags")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= MAX_TAG_LENGTH)
    .slice(0, MAX_TAGS);
  return tags.length > 0 ? { tags } : {};
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
  const toaster = useInject(Toaster);

  const routerState = useRouterState();
  const campaignIdParam = String(routerState.params.campaignId);
  const campaignId = Number(campaignIdParam);

  const { draft, clear: clearDraft } = useDraftAutofill(campaignIdParam);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (draft.tags && draft.tags.length > 0) {
      setTags(draft.tags);
    }
  }, [draft.tags]);

  const addTag = (raw: string) => {
    const candidate = raw.trim().slice(0, MAX_TAG_LENGTH);
    if (!candidate) return;
    if (tags.includes(candidate)) return;
    if (tags.length >= MAX_TAGS) {
      toaster.show(
        String(
          tr("petitions.request.tooManyTags", { args: [String(MAX_TAGS)] }),
        ),
        "danger",
      );
      return;
    }
    setTags((prev) => [...prev, candidate]);
  };

  const removeTag = (value: string) => {
    setTags((prev) => prev.filter((v) => v !== value));
  };

  const commitTagInput = () => {
    if (!tagInput.trim()) return;
    addTag(tagInput);
    setTagInput("");
  };

  // Client schema is intentionally looser than the server's — empty initial
  // values would fail TypeBox `minLength: 1` at form construction time even
  // before the user types. The server (`petitionBodySchema`) enforces the
  // real bounds.
  const form = useForm({
    schema: t.object({
      title: t.string({ maxLength: 200 }),
      description: t.string({ maxLength: 10_000 }),
    }),
    initialValues: { title: "", description: "" },
    handler: async (body) => {
      try {
        const { id } = await petitionApi.submitPetition({
          params: { campaignId },
          body: {
            title: body.title,
            description: body.description,
            attachments: attachments.map((a) => a.id),
            tags,
          },
        });
        clearDraft();
        toaster.show(String(tr("petitions.request.success")), "success");
        await router.push("campaignPetitionStatus", {
          params: {
            campaignId: campaignIdParam,
            petitionId: String(id),
          },
        });
      } catch (err: any) {
        toaster.show(
          err?.message ?? String(tr("petitions.request.error")),
          "danger",
        );
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
            err?.message ?? String(tr("petitions.request.uploadError")),
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
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:pt-16">
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:pt-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">{tr("petitions.request.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {tr("petitions.request.description")}
          </p>
        </div>

        <Card className="py-4 shadow">
          <CardContent className="px-4">
            <div className="mb-4 flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              {userPicture ? (
                <img
                  alt=""
                  src={`/api/files/${userPicture}`}
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

            <form {...form.props} className="flex flex-col gap-4">
              <Control
                input={form.input.title}
                label={String(tr("petitions.request.titleField"))}
                text
              />

              <Control
                input={form.input.description}
                label={String(tr("petitions.request.descriptionField"))}
                description={String(tr("petitions.request.descriptionHelper"))}
                area
              />

              <div className="flex flex-col gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="petition-tag-input"
                >
                  {tr("petitions.request.tags")}
                </label>
                <p className="text-muted-foreground text-xs">
                  {tr("petitions.request.tagsHelper")}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((tagValue) => (
                    <Badge
                      key={tagValue}
                      variant="secondary"
                      className="gap-1 font-mono text-[11px]"
                    >
                      {tagValue}
                      <button
                        type="button"
                        onClick={() => removeTag(tagValue)}
                        className="hover:text-foreground text-muted-foreground"
                        aria-label={`remove ${tagValue}`}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                  <Input
                    id="petition-tag-input"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        commitTagInput();
                      } else if (
                        e.key === "Backspace" &&
                        tagInput === "" &&
                        tags.length > 0
                      ) {
                        removeTag(tags[tags.length - 1]);
                      }
                    }}
                    onBlur={commitTagInput}
                    placeholder={String(tr("petitions.request.tagPlaceholder"))}
                    className="h-7 w-auto min-w-[160px] flex-1 font-mono text-xs"
                  />
                </div>
              </div>

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
                    {attachments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 rounded border border-border bg-muted/20 px-2 py-1 text-sm"
                      >
                        <Paperclip className="size-3.5 shrink-0" />
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
                    ))}
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
