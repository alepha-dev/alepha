import { SIGIL_FEEDBACK_SUBMITTED_MESSAGE } from "@alepha/sigil/messages";
import { Control } from "@alepha/ui/components/control/control";
import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { Loader2, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { FeedbackSource } from "@/api/schemas/feedbackSourceSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { displayName } from "../../../services/displayName.ts";
import type { I18n } from "../../../services/I18n.ts";
import type { MeRouter } from "../../profile/me/MeRouter.ts";
import PageHeader from "../../shared/header/PageHeader.tsx";
import { ProjectIcon } from "../../shared/ProjectIcon.tsx";
import { UserAvatar } from "../../shared/UserAvatar.tsx";

// Renamed from "lor.petition.draft" in the 2026-08 great rename (Task 4).
// Unlike the attachment bucket name (see FeedbackRateLimiter.ATTACHMENT_BUCKET),
// this key is not storage state — it only ever holds a draft in flight
// across an OAuth round-trip — so renaming it is safe. The one cost: any
// draft saved under the old key at deploy time is silently discarded once,
// since nothing reads it back under the new name.
const DRAFT_STORAGE_KEY = "lor.feedback.draft";
const MAX_FILES = 10;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 100;

type DraftContext = {
  tags?: string[];
  /** Page-context provenance captured by the sigil button (see source schema). */
  source?: FeedbackSource;
};

type Attachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
};

type ProjectContext = {
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
  // (feedback has no first-class type column; tags carry the taxonomy).
  const typeParam = query.get("type")?.trim().toLowerCase();
  if (
    (typeParam === "bug" || typeParam === "feature") &&
    !tags.includes(typeParam)
  ) {
    tags.unshift(typeParam);
  }

  const draft: DraftContext = {};
  if (tags.length > 0) draft.tags = tags;

  // Page-context provenance forwarded by the sigil button via the
  // `/sigil/request` popup (keys defined in `@alepha/sigil/context`). `url`
  // is the signal that this feedback originated from an embedded button; the
  // server schema (`feedbackSourceSchema`) re-validates every field on submit.
  const url = query.get("url")?.trim();
  if (url) {
    const source: FeedbackSource = {
      hostUrl: url,
      hostPath: query.get("path")?.trim() || url,
      userAgent: query.get("ua")?.trim() || "",
    };
    const title = query.get("title")?.trim();
    const referrer = query.get("ref")?.trim();
    const language = query.get("lang")?.trim();
    const viewport = query.get("vp")?.trim();
    const screen = query.get("scr")?.trim();
    const timezone = query.get("tz")?.trim();
    if (title) source.title = title;
    if (referrer) source.referrer = referrer;
    if (language) source.language = language;
    if (viewport) source.viewport = viewport;
    if (screen) source.screen = screen;
    if (timezone) source.timezone = timezone;
    draft.source = source;
  }

  return draft;
};

/**
 * Pull tag prefill from the URL into sessionStorage as soon as the page
 * mounts, then clean the URL via `history.replaceState`. Keeping the data in
 * sessionStorage (rather than the URL or localStorage) means: (a) it survives
 * the Google login redirect on the same tab, (b) it doesn't leak through
 * browser history or server logs, (c) it's automatically scoped to this tab
 * and cleared when the tab closes.
 */
const useDraftAutofill = (projectId: string) => {
  const key = `${DRAFT_STORAGE_KEY}.${projectId}`;
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

const ProjectFeedbackRequest = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const meRouter = useRouter<MeRouter>();
  const auth = useAuth();
  const feedbackApi = useClient<FeedbackController>();
  const toaster = useToast();

  const routerState = useRouterState();
  const projectIdParam = String(routerState.params.projectId);
  const projectId = Number(projectIdParam);

  const { draft, clear: clearDraft } = useDraftAutofill(projectIdParam);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // Tags are an internal triage taxonomy — never typed by the reporter.
  // They are seeded from query params (a "Feedback" button opening
  // `/request?tags=bug`) and kept in state only to ride along on submit.
  const [tags, setTags] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The submit handler is closed over by `FormModel` at first render (the
  // `useForm` `FormModel` is built once via `useMemo([])` — passing non-empty
  // `deps` would rebuild the model and wipe user-typed values). At first
  // render the draft, attachments and tags are all still empty — they are
  // populated asynchronously by effects. To let the frozen handler see live
  // values, mirror everything it needs into a ref that is refreshed on every
  // render.
  const liveRef = useRef<{
    attachments: Attachment[];
    tags: string[];
    source?: FeedbackSource;
  }>({
    attachments,
    tags,
    source: draft.source,
  });
  liveRef.current = {
    attachments,
    tags,
    source: draft.source,
  };

  useEffect(() => {
    if (draft.tags && draft.tags.length > 0) {
      setTags(draft.tags);
    }
  }, [draft.tags]);

  // Fetch minimal project info to show "submitting to X" on the form. This
  // page is a top-level route with no project data; the endpoint is gated
  // like `submitFeedback` (any logged-in user, feedback feature on). A
  // failed/pending fetch just hides the project side — never breaks the form.
  const [project, setProject] = useState<ProjectContext | null>(null);
  useEffect(() => {
    if (!auth.user || !Number.isFinite(projectId)) return;
    let cancelled = false;
    feedbackApi
      .feedbackContext({ params: { projectId } })
      .then((res) => {
        if (!cancelled) setProject(res);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user, projectId]);

  // One free-text field. Client schema stays looser than the server's — a
  // `minLength` here would fail TypeBox at form-construction time (empty
  // initial value). The server (`feedbackBodySchema`) enforces real bounds.
  const form = useForm({
    schema: z.object({
      message: z.string().max(10_000),
    }),
    initialValues: { message: "" },
    handler: async (body) => {
      // Read live state through the ref — the handler closure itself is
      // frozen at first render, when these were all still empty.
      const { attachments, tags, source } = liveRef.current;
      try {
        const attachmentIds = attachments.map((a) => a.id);

        // The reporter writes one free-text blob. Derive a short title from
        // its first non-empty line so the owner's triage inbox has a
        // per-row label; `description` keeps the full text.
        const message = body.message.trim();
        const firstLine =
          message
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? message;

        await feedbackApi.submitFeedback({
          params: { projectId },
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

        // Opened as the sigil feedback popup (`window.open(..., "lore-feedback")`)?
        // Tell the host page's feedback button to flash a thank-you, then close
        // instantly instead of navigating to the in-popup status page.
        if (
          typeof window !== "undefined" &&
          window.name === "lore-feedback" &&
          window.opener
        ) {
          window.opener.postMessage(
            { type: SIGIL_FEEDBACK_SUBMITTED_MESSAGE },
            "*",
          );
          window.close();
          return;
        }

        toaster.show(tr("feedback.request.success"), "success");

        // Land the reporter on their cross-project feedback list (the
        // dedicated status page was retired in favour of /me/feedback).
        await meRouter.push("myFeedback");
      } catch (err: any) {
        toaster.show(err?.message ?? tr("feedback.request.error"), "danger");
      }
    },
  });
  const { loading: submitting } = useFormState(form, ["loading"]);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (attachments.length + files.length > MAX_FILES) {
      toaster.show(
        String(
          tr("feedback.request.tooManyFiles", { args: [String(MAX_FILES)] }),
        ),
        "danger",
      );
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        try {
          const result = await feedbackApi.uploadFeedbackAttachment({
            params: { projectId },
            body: { file },
          });
          setAttachments((prev) => [...prev, result]);
        } catch (err: any) {
          toaster.show(
            err?.message ?? tr("feedback.request.uploadError"),
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
  }, [auth.user, attachments.length, projectId]);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Cancelling must never push to the project view: that route is
  // members-only (`assertMember`), but this form is open to ANY logged-in
  // user (it's the external feedback channel), so a non-member reporter would
  // 403 into the error boundary — the bug feedback #7 reported. Instead:
  // close the sigil popup (as a successful submit does), else go back, else
  // land on the reporter's own feedback list.
  const handleCancel = () => {
    if (typeof window === "undefined") return;
    if (window.name === "lore-feedback") {
      window.close();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void meRouter.push("myFeedback");
  };

  if (!auth.user) {
    // Anonymous: invite to log in. The draft was already persisted to
    // sessionStorage on mount, so it survives the round-trip through Google.
    return (
      <>
        <PageHeader />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pt-16">
            <Card className="shadow">
              <CardContent className="flex flex-col gap-4">
                <h1 className="text-xl font-semibold">
                  {tr("feedback.request.loginRequiredTitle")}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {tr("feedback.request.loginRequiredBody")}
                </p>
                <Button
                  onClick={() =>
                    router.push("login", {
                      query: { r: window.location.pathname },
                    })
                  }
                >
                  {tr("feedback.request.signIn")}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  const userLabel = displayName(auth.user, "");
  const userPicture = (auth.user as any).picture as string | undefined;

  return (
    <>
      <PageHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pt-16">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold">
              {tr("feedback.request.title")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr("feedback.request.description")}
            </p>
          </div>

          <Card className="py-4 shadow">
            <CardContent className="px-4">
              <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar fileId={userPicture} className="size-8" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {userLabel}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {tr("feedback.request.submittingAs")}
                    </span>
                  </div>
                </div>

                {project && (
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex min-w-0 flex-col items-end text-right">
                      <span className="truncate text-sm font-medium">
                        {project.title}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {tr("feedback.request.forProject")}
                      </span>
                    </div>
                    <ProjectIcon fileId={project.icon} className="size-8" />
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
                    label={tr("feedback.request.messageField")}
                    description={tr("feedback.request.messageHelper")}
                    area
                    autoFocus
                    rows={12}
                  />
                  <p className="text-muted-foreground text-xs">
                    {tr("feedback.request.pasteHint")}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    {tr("feedback.request.attachments")}
                  </label>
                  <p className="text-muted-foreground text-xs">
                    {tr("feedback.request.attachmentsHelper")}
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
                      {tr("feedback.request.attach")}
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      {tr("feedback.request.attachmentsCount", {
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
                              <FileImage
                                id={a.id}
                                alt=""
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
                    onClick={handleCancel}
                    disabled={submitting}
                  >
                    {tr("feedback.request.cancel")}
                  </Button>
                  <Button type="submit" disabled={submitting || uploading}>
                    {submitting && <Loader2 className="size-4 animate-spin" />}
                    {tr("feedback.request.submit")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default ProjectFeedbackRequest;
