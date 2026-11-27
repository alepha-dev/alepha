import { Button, cn, useDialog } from "@alepha/ui";
import type { HostJobController } from "@lore/core/api";
import {
  AgentJobStepper,
  currentProjectAtom,
  type I18n,
  sidePanelAtom,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useClient,
  useInject,
  useQuery,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ArrowUpRight, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import { jobPanelAtom } from "../../atoms/jobPanelAtom.ts";
import { JOB_STATUS_ICON } from "../host-jobs/jobStatusIcon.ts";
import JobUsualBar from "../host-jobs/JobUsualBar.tsx";
import ProjectJobTranscript from "../host-jobs/ProjectJobTranscript.tsx";
import { useJobReader } from "../host-jobs/useJobReader.ts";
import { JOB_HEADER_STATUS, jobArgsText, jobClock } from "./jobsHeaderText.ts";

/**
 * A job watched from any page (#Q4515): opened from a row of the header's
 * jobs list, on the right of the page and over it, mounted once at the
 * layout's root (`ShellExtensionRegistry.registerOverlay`), so it stays
 * open from page to page inside the project.
 *
 * - The job: its status glyph, prompt and args, host and elapsed time.
 * - Its transcript, live, the job page's own (`ProjectJobTranscript`):
 *   an ended job's final reply first, then what the agent did, following
 *   the end until the member scrolls up.
 * - Under its header, its steps as the job page draws them (#Q4545): quest
 *   k of N, live while it runs, the final count once it ended; for a
 *   running job with no steps, its prompt's usual time when it has one.
 * - At its foot, Open job and, for a job in flight, Cancel, confirmed.
 *
 * It reads the job through `useJobReader`, the job page's own reader, and
 * stops when the job ends or the panel closes. One panel at a time: opening
 * it closes the assistant and the reverse (`sidePanelAtom`). It closes with
 * its button, Escape, and on leaving the project; full width on a phone.
 */
const JobSidePanel = () => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const prompts = useClient<PromptController>();
  const dialog = useDialog();
  const dateTime = useInject(DateTimeProvider);
  // The job page is core's own: another router declares it.
  const router = useRouter<any>();
  const [project] = useStore(currentProjectAtom);
  const [panel, setPanel] = useStore(jobPanelAtom);
  const [side] = useStore(sidePanelAtom);
  const jobId = panel?.jobId;
  const open = !!jobId;
  const close = () => setPanel({});
  const { job, row, transcript, live, inFlight } = useJobReader(jobId, {
    enabled: open,
  });
  const slug = project?.slug ?? String(project?.id ?? "");

  // Another panel took the right of the page: this one gives it up.
  useEffect(() => {
    if (open && side?.panel !== "job") setPanel({});
  }, [open, side?.panel]);

  // Leaving the project closes it.
  const projectId = useRef(project?.id);
  useEffect(() => {
    if (projectId.current !== project?.id && open) setPanel({});
    projectId.current = project?.id;
  }, [project?.id]);

  // Escape closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A dialog over the panel (the Cancel confirm) takes its own Escape.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return;
      }
      setPanel({});
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [open]);

  // The elapsed time of a running job, every second.
  const [now, setNow] = useState(() => dateTime.nowMillis());
  const running = row?.status === "running";
  useEffect(() => {
    if (!open || !running) return;
    const timer = globalThis.setInterval(
      () => setNow(dateTime.nowMillis()),
      1000,
    );
    return () => globalThis.clearInterval(timer);
  }, [open, running, dateTime]);

  const titles = useQuery(
    {
      enabled: open && project?.id !== undefined,
      key: ["project-prompts", project?.id],
      handler: () =>
        prompts.listPrompts({ params: { projectId: project?.id as number } }),
      onError: () => {},
    },
    [prompts, project?.id, open],
  );

  const cancel = useAction<[], void>(
    {
      handler: async () => {
        if (!jobId) return;
        const ok = await dialog.confirm({
          title: tr("jobs.cancel.title"),
          description: tr("jobs.cancel.confirm"),
          confirmLabel: tr("jobs.cancel.yes"),
          cancelLabel: tr("jobs.cancel.no"),
          destructive: true,
        });
        if (!ok) return;
        await api.cancelJob({ params: { jobId } });
        await job.refetch();
      },
    },
    [jobId],
  );

  if (!open) return null;

  const status = row ? JOB_STATUS_ICON[row.status] : undefined;
  const Glyph = status?.icon;
  const title =
    (row?.prompt &&
      titles.data?.items.find((it) => it.name === row.prompt)?.title) ||
    row?.prompt ||
    row?.kind ||
    "";
  const args = row ? jobArgsText(row) : "";
  const elapsed = row
    ? running
      ? jobClock((now - Date.parse(row.startedAt ?? row.queuedAt)) / 1000)
      : row.startedAt && row.endedAt
        ? jobClock((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 1000)
        : ""
    : "";

  return (
    <aside
      // Under the header on a wide screen, so its jobs button stays in reach;
      // the whole screen on a phone.
      className="bg-card fixed inset-0 z-40 flex flex-col shadow-xl sm:inset-auto sm:end-2 sm:top-[4.75rem] sm:bottom-2 sm:w-[30rem] sm:rounded-lg sm:border"
      aria-label={tr("jobs.panel.label")}
      data-testid="job-panel"
    >
      <header className="chrome flex items-start gap-3 border-b px-4 py-3">
        {Glyph && (
          <Glyph className={cn("mt-1 size-4 shrink-0", status?.className)} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" data-testid="job-panel-title">
            {title}
            {args && (
              <span className="text-muted-foreground font-normal"> {args}</span>
            )}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {[row?.hostSlug, row ? tr(JOB_HEADER_STATUS[row.status]) : ""]
              .filter(Boolean)
              .join(" · ")}
            {elapsed && (
              <span className="font-mono tabular-nums"> · {elapsed}</span>
            )}
          </p>
          {row?.steps && (
            <AgentJobStepper
              steps={row.steps}
              {...(row.pace ? { pace: row.pace } : {})}
              running={running}
              {...(row.startedAt ? { startedAt: row.startedAt } : {})}
              timeoutSeconds={row.input.timeoutSeconds}
              className="mt-2"
            />
          )}
          {!row?.steps && running && row?.usual && row.startedAt && (
            <div className="mt-2">
              <JobUsualBar usual={row.usual} startedAt={row.startedAt} />
            </div>
          )}
        </div>
        <Button
          variant="minimal"
          size="icon-sm"
          aria-label={tr("jobs.panel.close")}
          title={tr("jobs.panel.close")}
          onClick={close}
          data-testid="job-panel-close"
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {row && (
          <ProjectJobTranscript
            job={row}
            transcript={transcript}
            live={live && inFlight}
          />
        )}
      </div>
      <footer className="chrome flex items-center gap-2 border-t px-4 py-3">
        <Button
          size="sm"
          onClick={() => {
            if (!jobId) return;
            close();
            void router.push("projectJob", {
              params: { projectSlug: slug, jobId },
            });
          }}
          data-testid="job-panel-open"
        >
          <ArrowUpRight className="size-4" />
          {tr("jobs.panel.open")}
        </Button>
        {row && inFlight && (
          <Button
            size="sm"
            variant="outlined"
            intent="danger"
            className="ms-auto"
            disabled={cancel.loading}
            onClick={() => void cancel.run()}
            data-testid="job-panel-cancel"
          >
            <Square className="size-4" />
            {tr("jobs.cancel")}
          </Button>
        )}
      </footer>
    </aside>
  );
};

export default JobSidePanel;
