import { SIGIL_FEEDBACK_SUBMITTED_MESSAGE } from "@alepha/lore/sigil";
import { Control } from "@alepha/ui/components/control/control";
import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { Loader2, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { FeedbackSource } from "@/api/schemas/feedbackSourceSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { displayName } from "../../../services/displayName.ts";
import type { I18n } from "../../../services/I18n.ts";
import type { LoreAccountRouter } from "../../account/LoreAccountRouter.ts";
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
/**
 * Used only until `feedbackContext` answers — the server owns both caps (see
 * `feedbackOptionsAtom`) and the form quotes whatever it returns. Kept as a
 * fallback rather than gating the attachment UI on the fetch: the context call
 * is allowed to fail without breaking the form, and an attach button that
 * never appears would be a worse failure than one whose stated cap is briefly
 * the default.
 */
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_FILE_SIZE_MB = 5;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 100;

type DraftContext = {
  tags?: string[];
  /**
   * Page-context provenance captured by the sigil button (see source schema).
   */
  source?: FeedbackSource;
};

type Attachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
};

type ProjectContext = {
  /**
   * The integer id `submitFeedback` and `uploadFeedbackAttachment` take. The
   * URL carries the slug, and this page is outside the project route layout,
   * so `feedbackContext` is the only place the id can come from.
   */
  projectId: number;
  title: string;
  icon?: string | null;
  maxAttachments: number;
  maxFileSizeMb: number;
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
  // `/sigil/request` popup (keys defined in `@alepha/lore`). `url`
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
      // Reads `window.location` and `sessionStorage` and rewrites the URL — all
      // client-only, so the draft cannot be seeded during render without breaking
      // hydration.
      // oxlint-disable-next-line react/set-state-in-effect
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
  const dateTime = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const meRouter = useRouter<LoreAccountRouter>();
  const auth = useAuth();
  const feedbackApi = useClient<FeedbackController>();
  const toaster = useToast();

  const routerState = useRouterState();
  const projectSlug = String(routerState.params.projectSlug ?? "");

  // Keyed on the slug rather than the integer id: the id is not known until
  // `feedbackContext` answers, and a draft is transient `sessionStorage` for
  // one tab. Nothing survives from the old `/p/:id/request` URLs anyway — they
  // are gone, so no draft written under an id key is reachable any more.
  const { draft, clear: clearDraft } = useDraftAutofill(projectSlug);
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
    /**
     * Resolved asynchronously by `feedbackContext`, so it rides the ref for the
     * same reason as everything else here: the submit handler is frozen at
     * first render, when the context has not answered yet.
     */
    projectId?: number;
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

  const [seededTags, setSeededTags] = useState(draft.tags);
  if (draft.tags !== seededTags) {
    setSeededTags(draft.tags);
    if (draft.tags && draft.tags.length > 0) {
      setTags(draft.tags);
    }
  }

  // Fetch minimal project info to show "submitting to X" on the form. This
  // page is a top-level route with no project data; the endpoint is gated
  // like `submitFeedback` (any logged-in user, feedback feature on). A
  // failed/pending fetch just hides the project side — never breaks the form.
  const [project, setProject] = useState<ProjectContext | null>(null);
  // Undefined until the context resolves. Every write path below is guarded on
  // it — the form cannot submit to a project it has not identified yet.
  const projectId = project?.projectId;
  // Declared after `liveRef` is rebuilt above, so it has to be set separately.
  liveRef.current.projectId = projectId;
  const maxFiles = project?.maxAttachments ?? DEFAULT_MAX_FILES;
  const maxFileSizeMb = project?.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB;
  // The context fetch is the form's only source of the integer project id, so
  // its failure must not leave the form rendered: every action would funnel
  // into the `projectId === undefined` guards and die silently — Cmd+V, the
  // Attach button, drag-drop, submit, all no-ops with no feedback. "closed"
  // (the module is off, or the slug is stale) and "error" (transient) render
  // different messages because they call for different user reactions.
  const [contextState, setContextState] = useState<
    "loading" | "ready" | "closed" | "error"
  >("loading");
  useEffect(() => {
    if (!auth.user || !projectSlug) return;
    let cancelled = false;
    feedbackApi
      .feedbackContext({ params: { slug: projectSlug } })
      .then((res) => {
        if (cancelled) return;
        setProject(res);
        setContextState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setProject(null);
        setContextState(
          HttpError.is(err, 403) || HttpError.is(err, 404) ? "closed" : "error",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user, projectSlug]);

  // One free-text field. Client schema stays looser than the server's — a
  // `minLength` here would fail validation at form-construction time (empty
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

        // The id arrives with `feedbackContext`, so a submit fired before that
        // resolved (or after it failed) has no project to post to. The form is
        // only reachable with the context panel rendered, so this is a guard
        // rather than a state the user can sit in.
        const target = liveRef.current.projectId;
        if (target === undefined) {
          toaster.show(tr("feedback.request.error"), "danger");
          return;
        }

        await feedbackApi.submitFeedback({
          params: { projectId: target },
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
    // Attachments are addressed by the integer project id, which only exists
    // once `feedbackContext` has answered. The attach control is rendered from
    // the same state, so this is unreachable in practice.
    if (projectId === undefined) return;
    if (attachments.length + files.length > maxFiles) {
      toaster.show(
        String(
          tr("feedback.request.tooManyFiles", { args: [String(maxFiles)] }),
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
  // Not bound before the context resolves: without a project id the handler
  // could only preventDefault the paste and then drop it on the floor.
  useEffect(() => {
    if (!auth.user || projectId === undefined) return;
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
            const named = new File(
              [file],
              `pasted-${dateTime.nowMillis()}${ext}`,
              {
                type: file.type,
              },
            );
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
                      query: { redirect: window.location.pathname },
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

  if (contextState !== "ready") {
    // No project id, no form: rendering it anyway is the bug this branch
    // fixes — every action (paste, attach, drop, submit) funnels into a
    // `projectId === undefined` guard and dies with no feedback at all.
    return (
      <>
        <PageHeader />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pt-16">
            {contextState === "loading" ? (
              <div className="flex justify-center py-16">
                <Loader2 className="text-muted-foreground size-6 animate-spin" />
              </div>
            ) : (
              <Card className="shadow">
                <CardContent className="flex flex-col gap-4">
                  <h1 className="text-xl font-semibold">
                    {tr(
                      contextState === "closed"
                        ? "feedback.request.closedTitle"
                        : "feedback.request.unavailableTitle",
                    )}
                  </h1>
                  <p className="text-muted-foreground text-sm">
                    {tr(
                      contextState === "closed"
                        ? "feedback.request.closedBody"
                        : "feedback.request.unavailableBody",
                    )}
                  </p>
                </CardContent>
              </Card>
            )}
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
              <div className="border-border bg-muted/30 mb-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
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
                {/* file-attachment drop zone — the textarea inside is the real control, drag handlers are a progressive enhancement */}
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
                    dragging ? "ring-primary ring-2 ring-offset-2" : ""
                  }`}
                >
                  <Control
                    input={form.input.message}
                    label={tr("feedback.request.messageField")}
                    description={tr("feedback.request.messageHelper")}
                    area

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
                    {tr("feedback.request.attachmentsHelper", {
                      args: [String(maxFileSizeMb), String(maxFiles)],
                    })}
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
                      disabled={uploading || attachments.length >= maxFiles}
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
                        args: [String(attachments.length), String(maxFiles)],
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
                            className="border-border bg-muted/20 flex items-center gap-2 rounded border px-2 py-1 text-sm"
                          >
                            {isImage ? (
                              <FileImage
                                id={a.id}
                                alt=""
                                className="border-border size-10 shrink-0 rounded border object-cover"
                              />
                            ) : (
                              <Paperclip className="size-3.5 shrink-0" />
                            )}
                            <span className="flex-1 truncate">{a.name}</span>
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

                {/*
                  No Cancel button (#174). It sat one edge away from Submit and
                  threw the report away with no prompt: in the sigil popup —
                  the primary way this form is reached — it called
                  `window.close()`, and the draft lives in `sessionStorage`,
                  which dies with the window. Text and uploaded attachments,
                  gone, unrecoverable, next to the button you meant to press.
                  The popup already closes from its own chrome and a normal tab
                  has the back button, so nothing was lost with it.

                  The link on the left is deliberately at the FAR end of this
                  row from Submit, for the same reason (#175).
                */}
                <div className="flex items-center justify-between gap-2 pt-2">
                  {/*
                    A plain anchor, not the router's `Link`: inside the popup a
                    client-side navigation would replace this document — losing
                    the form — and a full page load would trap the whole app in
                    a 540×790 chrome-less window. `target="_blank"` opens it in
                    the parent browser, which is right in a normal tab too.
                  */}
                  <a
                    href={meRouter.path("myFeedback")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                  >
                    {tr("feedback.request.myFeedbackLink")}
                  </a>
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
