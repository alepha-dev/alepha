import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { t } from "alepha";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { Bug, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import { Toaster } from "../../../services/Toaster.ts";

const DRAFT_STORAGE_KEY = "lor.petition.draft";
const MAX_FILES = 10;

type DraftContext = {
  url?: string;
  path?: string;
  title?: string;
  description?: string;
  type?: "bug" | "feature";
};

type Attachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
};

const readDraftFromQuery = (query: URLSearchParams): DraftContext => {
  const draft: DraftContext = {};
  const path = query.get("path");
  const url = query.get("url");
  const title = query.get("title");
  const description = query.get("description");
  const type = query.get("type");
  if (path) draft.path = path;
  if (url) draft.url = url;
  if (title) draft.title = title;
  if (description) draft.description = description;
  if (type === "bug" || type === "feature") draft.type = type;
  return draft;
};

/**
 * Pull autofill metadata from the URL into sessionStorage as soon as the page
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Client schema is intentionally looser than the server's — empty initial
  // values would fail TypeBox `minLength: 1` at form construction time even
  // before the user types. The server (`petitionBodySchema`) enforces the
  // real bounds.
  const form = useForm({
    schema: t.object({
      title: t.string({ maxLength: 200 }),
      description: t.string({ maxLength: 10_000 }),
      reportType: t.enum(["bug", "feature"], {
        mode: "text",
        default: "bug",
      }),
    }),
    initialValues: {
      title: draft.title ?? "",
      description: draft.description ?? "",
      reportType: draft.type ?? "bug",
    },
    handler: async (body) => {
      try {
        const { id } = await petitionApi.submitPetition({
          params: { campaignId },
          body: {
            title: body.title,
            description: body.description,
            reportType: body.reportType,
            attachments: attachments.map((a) => a.id),
            context: { url: draft.url, path: draft.path },
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

  const onFilePicked = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
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
      for (const file of Array.from(files)) {
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

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  if (!auth.user) {
    // Anonymous: invite to log in. The draft was already persisted to
    // sessionStorage on mount, so it survives the round-trip through Google.
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <Card className="shadow">
          <CardContent className="flex flex-col gap-4 p-6">
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
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">{tr("petitions.request.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {tr("petitions.request.description")}
        </p>
      </div>

      <Card className="shadow">
        <CardContent className="p-4">
          <form {...form.props} className="flex flex-col gap-4">
            <Control
              input={form.input.reportType}
              label={String(tr("petitions.request.type"))}
              custom={({ value, onChange }) => (
                <Segmented
                  value={value != null ? String(value) : "bug"}
                  onChange={(v) => onChange(v)}
                  options={[
                    {
                      value: "bug",
                      label: (
                        <span className="inline-flex items-center gap-1">
                          <Bug className="size-4 text-red-500" />
                          {tr("petitions.request.typeBug")}
                        </span>
                      ),
                    },
                    {
                      value: "feature",
                      label: (
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="size-4 text-emerald-500" />
                          {tr("petitions.request.typeFeature")}
                        </span>
                      ),
                    },
                  ]}
                  fullWidth
                />
              )}
            />

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
                {form.submitting && <Loader2 className="size-4 animate-spin" />}
                {tr("petitions.request.submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default CampaignPetitionRequest;
