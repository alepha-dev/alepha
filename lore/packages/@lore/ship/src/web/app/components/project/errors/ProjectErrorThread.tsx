import { useDialog, useToast } from "@alepha/ui";
import {
  CollapsibleBlock,
  DiscussionComposer,
  type I18n,
  mentionHandle,
  preloadMarkdownEditor,
  useProjectUsers,
} from "@lore/core/web";
import { useAction, useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ProjectErrorThreadController } from "../../../../../api/controllers/ProjectErrorThreadController.ts";
import type { ProjectErrorDetail } from "../../../../../api/schemas/projectErrorDetailSchema.ts";
import { QUEST_STATUS_PREFIX } from "../../../../../api/schemas/projectErrorQuestStatus.ts";
import type { ProjectErrorThreadEntry } from "../../../../../api/schemas/projectErrorThreadEntrySchema.ts";
import type { ProjectErrorThreadJob } from "../../../../../api/schemas/projectErrorThreadJobSchema.ts";
import ProjectErrorThreadComment from "./ProjectErrorThreadComment.tsx";
import { buildProjectErrorTimeline } from "./projectErrorThreadEntries.ts";
import ProjectErrorThreadEvent from "./ProjectErrorThreadEvent.tsx";
import ProjectErrorThreadRun from "./ProjectErrorThreadRun.tsx";
import ProjectErrorTrustNotice from "./ProjectErrorTrustNotice.tsx";

export interface ProjectErrorThreadProps {
  detail: ProjectErrorDetail;
  projectId: number;
  projectSlug: string;
  questHref: (shortId: number) => string;
  /**
   * Trust the error, from the notice an untrusted one shows. Absent for a
   * member who may not triage.
   */
  onTrust?: () => void;
  /**
   * Forward the error to a new quest carrying one comment as its finding
   * (#Q4471). Absent for a member who may not forward, and on a project
   * with no Plan.
   */
  onForwardFinding?: (commentId: number) => void;
  /**
   * An agent job's page, for a member who may read jobs.
   */
  jobHref?: (jobId: string) => string;
  /**
   * The last agent run on the error ended while the page was open: the
   * error itself may have moved (a forward), so the page reads it again.
   */
  onRunEnded?: () => void;
  /**
   * A triage verb is running elsewhere on the page.
   */
  busy: boolean;
  /**
   * The trust asked from the notice is running.
   */
  trusting?: boolean;
  /**
   * A forward asked from a comment is running.
   */
  forwarding?: boolean;
}

/**
 * The lower part of an error's page (#E185): its activity and its
 * discussion as one timeline, oldest first, and a composer. The questions
 * that come before a quest (noise or real, which deploy, ignore it) are
 * asked and answered here, by members and by agents.
 *
 * Every member who reads errors may write; the triage verbs stay where they
 * are, on the page's header.
 */
const ProjectErrorThread = (props: ProjectErrorThreadProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<ProjectErrorThreadController>();
  const auth = useAuth();
  const dialog = useDialog();
  const toaster = useToast();
  const users = useProjectUsers();
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  // The comment a forward or a delete was asked from: its button spins.
  const [forwardingId, setForwardingId] = useState<number>();
  const [deletingId, setDeletingId] = useState<number>();
  const errorId = props.detail.error.id;
  const params = { projectId: props.projectId, errorId };
  const key = ["project-error-thread", props.projectId, errorId];

  // The composer is a markdown editor: its chunk is warmed on mount rather
  // than paid at the first click in the box.
  useEffect(() => {
    preloadMarkdownEditor();
  }, []);

  // Keyed on the error, so a verb elsewhere on the page (which invalidates
  // this key) brings its event in. The answer carries the error it was read
  // for: one error's thread is never shown under the next.
  const threadQuery = useQuery(
    {
      key,
      keepPreviousData: true,
      // While an agent run is queued or running the thread reads itself
      // again: its answer arrives as a comment, with nobody on the page
      // having acted. It stops with the run, and `runEvery` skips a hidden
      // tab.
      runEvery: running ? RUN_POLL_MS : undefined,
      handler: async () => {
        const read = await api.listProjectErrorThread({ params });
        const jobs = read.jobs ?? NO_JOBS;
        setRunning(
          jobs.some(
            (job) => job.status === "queued" || job.status === "running",
          ),
        );
        return { errorId, entries: read.entries, jobs };
      },
    },
    [api, props.projectId, errorId, running],
  );
  const current =
    threadQuery.data?.errorId === errorId ? threadQuery.data : undefined;
  const thread = current?.entries ?? NO_ENTRIES;
  const jobs = current?.jobs ?? NO_JOBS;

  // The last run ended while the page was open: the error itself may have
  // moved (a forward), so the page reads it again.
  const wasRunning = useRef(false);
  const onRunEnded = props.onRunEnded;
  useEffect(() => {
    if (wasRunning.current && !running) onRunEnded?.();
    wasRunning.current = running;
  }, [running, onRunEnded]);

  const post = useAction(
    {
      handler: async () => {
        const body = draft.trim();
        if (!body) return;
        await api.createProjectErrorComment({ params, body: { body } });
        setDraft("");
      },
      invalidates: [key],
    },
    [api, props.projectId, errorId, draft],
  );

  const remove = useAction<[entry: ProjectErrorThreadEntry], void>(
    {
      handler: async (_context, entry) => {
        const ok = await dialog.confirm({
          title: tr("errors.thread.deleteConfirm"),
          confirmLabel: tr("errors.action.delete"),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return;
        await api.deleteProjectErrorComment({
          params: { ...params, commentId: entry.id },
        });
        toaster.success(tr("errors.thread.toast.deleted"));
      },
      invalidates: [key],
    },
    [api, props.projectId, errorId, dialog],
  );

  const busy = props.busy || post.loading || remove.loading;
  const viewerId = (auth.user as { id?: string } | undefined)?.id;
  const members = users.map((user) => mentionHandle(user));
  const timeline = buildProjectErrorTimeline(props.detail, thread, jobs);
  const forwarded = props.detail.error.status.startsWith(QUEST_STATUS_PREFIX);
  const onForwardFinding = forwarded ? undefined : props.onForwardFinding;

  return (
    <CollapsibleBlock
      icon={<MessageSquare className="size-5" />}
      label={tr("errors.thread.title")}
      defaultOpen
      testId="error-thread"
    >
      {!props.detail.error.trustedAt &&
        props.detail.error.status === "open" && (
          <ProjectErrorTrustNotice
            onTrust={props.onTrust}
            busy={busy}
            trusting={props.trusting}
          />
        )}
      <ol className="divide-border/40 flex flex-col divide-y px-1">
        {timeline.map((entry) =>
          entry.type === "job" ? (
            <ProjectErrorThreadRun
              key={entry.key}
              job={entry.job}
              href={props.jobHref?.(entry.job.id)}
            />
          ) : entry.type === "comment" ? (
            <ProjectErrorThreadComment
              key={entry.key}
              entry={entry.entry}
              projectId={props.projectId}
              projectSlug={props.projectSlug}
              errorId={errorId}
              members={members}
              busy={busy}
              deleting={remove.loading && deletingId === entry.entry.id}
              forwarding={!!props.forwarding && forwardingId === entry.entry.id}
              onDelete={
                viewerId && entry.entry.userId === viewerId
                  ? () => {
                      setDeletingId(entry.entry.id);
                      void remove
                        .run(entry.entry)
                        .finally(() => setDeletingId(undefined));
                    }
                  : undefined
              }
              // An agent's finding, on an error not forwarded yet.
              onForward={
                onForwardFinding && entry.entry.source
                  ? () => {
                      setForwardingId(entry.entry.id);
                      onForwardFinding(entry.entry.id);
                    }
                  : undefined
              }
            />
          ) : (
            <ProjectErrorThreadEvent
              key={entry.key}
              entry={entry}
              questHref={props.questHref}
            />
          ),
        )}
      </ol>
      {/* Reading errors is enough to write on one: read off the action, so
          nothing here repeats a permission string. */}
      {api.createProjectErrorComment.can() && (
        <DiscussionComposer
          value={draft}
          onChange={setDraft}
          onSubmit={() => void post.run()}
          busy={busy}
          sending={post.loading}
          placeholder={tr("errors.thread.placeholder")}
          submitLabel={tr("errors.thread.submit")}
          // An editor with the `@` picker; no image paste, since an error
          // comment carries no attachment.
          element={{
            kind: "error",
            projectId: props.projectId,
            projectSlug: props.projectSlug,
            id: errorId,
          }}
          members={members}
          imageUpload={false}
        />
      )}
    </CollapsibleBlock>
  );
};

export default ProjectErrorThread;

/**
 * One empty thread, so an error whose thread is loading keeps the entries'
 * identity across renders.
 */
const NO_ENTRIES: ProjectErrorThreadEntry[] = [];
const NO_JOBS: ProjectErrorThreadJob[] = [];

/**
 * How often the thread reads itself again while an agent run is going.
 */
const RUN_POLL_MS = 5_000;
