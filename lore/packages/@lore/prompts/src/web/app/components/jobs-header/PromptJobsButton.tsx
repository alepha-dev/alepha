import {
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui";
import type { HostJobController } from "@lore/core/api";
import type { HostJobResource } from "@lore/core/schemas";
import {
  currentProjectAtom,
  hasCapability,
  type I18n,
  sidePanelAtom,
  useRank,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { ArrowUpRight, Bot } from "lucide-react";
import { useEffect, useState } from "react";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import { jobPanelAtom } from "../../atoms/jobPanelAtom.ts";
import { jobInFlight } from "../host-jobs/jobStatusIcon.ts";
import {
  jobsAnnouncementAtom,
  jobsStartedHereAtom,
} from "./jobsHeaderAtoms.ts";
import { JOB_HEADER_STATUS, jobArgsText } from "./jobsHeaderText.ts";
import PromptJobsRow from "./PromptJobsRow.tsx";

/**
 * The header's jobs button (#Q4514), registered from `PromptsShell` on
 * core's `ShellExtensionRegistry`, beside the bell: inside a project with
 * Prompts on, for a member with `host:read`, which the jobs API asks.
 *
 * - **The button**: a robot, a ring turning around it while a job runs, and
 *   the count of jobs in flight (queued and running). With none, the icon.
 * - **Its popover**: the counts, then one row per job, newest first: the
 *   project's agent jobs in flight, whoever started them, and those that
 *   ended in the last 15 minutes with their end state (a call of the quest,
 *   the owner's to change). A row opens the job in the side panel
 *   (#Q4515).
 * - **What it says**: for about three seconds, it widens with the name of a
 *   job this tab started, once queued and once ended. No motion under
 *   reduced motion.
 *
 * One list read answers the button and the popover: every 3 s while a job
 * is in flight or the popover is open, every 30 s otherwise, never in a
 * hidden tab (`runEvery` skips it).
 */
const PromptJobsButton = () => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const prompts = useClient<PromptController>();
  const { can } = useRank();
  const dateTime = useInject(DateTimeProvider);
  const [project] = useStore(currentProjectAtom);
  const [started, setStarted] = useStore(jobsStartedHereAtom);
  const [announcement, setAnnouncement] = useStore(jobsAnnouncementAtom);
  const [, setJobPanel] = useStore(jobPanelAtom);
  const [, setSidePanel] = useStore(sidePanelAtom);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => dateTime.nowMillis());
  const shown =
    project?.id !== undefined &&
    hasCapability(project, "prompts") &&
    can("host:read");
  const slug = project?.slug ?? String(project?.id ?? "");

  const list = useQuery(
    {
      enabled: shown,
      key: ["host-jobs-header", project?.id],
      keepPreviousData: true,
      runEvery: busy || open ? 3000 : 30000,
      handler: async () => {
        const page = await api.listProjectJobs({
          params: { projectId: project?.id as number },
          // Every kind is listed: enough rows that the agent jobs in flight
          // are among them.
          query: { limit: 100 },
        });
        const items = page.items.filter((job) => job.kind === "agent");
        // Polled every 3 s while one may still move, as the jobs table is.
        setBusy(items.some((job) => jobInFlight(job.status)));
        return items;
      },
      onError: () => {},
    },
    [api, project?.id, shown, busy, open],
  );
  const titles = useQuery(
    {
      enabled: shown,
      key: ["project-prompts", project?.id],
      handler: () =>
        prompts.listPrompts({ params: { projectId: project?.id as number } }),
      onError: () => {},
    },
    [prompts, project?.id, shown],
  );
  const titleOf = (name: string | undefined) =>
    (name && titles.data?.items.find((it) => it.name === name)?.title) ||
    name ||
    "";

  const jobs = list.data ?? [];
  const recent = now - PromptJobsButton.RECENT_MS;
  const listed = jobs
    .filter(
      (job) =>
        jobInFlight(job.status) ||
        (job.endedAt !== undefined && Date.parse(job.endedAt) >= recent),
    )
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
  const running = listed.filter((job) => job.status === "running").length;
  const queued = listed.filter((job) => job.status === "queued").length;
  const inFlight = running + queued;

  // The clock the rows' elapsed time and the 15 minutes read: every second
  // while the list is open on a running job, every 30 s otherwise.
  useEffect(() => {
    const every = open && running > 0 ? 1000 : 30000;
    const timer = globalThis.setInterval(
      () => setNow(dateTime.nowMillis()),
      every,
    );
    return () => globalThis.clearInterval(timer);
  }, [open, running, dateTime]);

  // A job this tab started that ended: said once, then forgotten.
  useEffect(() => {
    if (started.length === 0) return;
    const ended = jobs.filter(
      (job) => started.includes(job.id) && !jobInFlight(job.status),
    );
    if (ended.length === 0) return;
    const last = ended[0]!;
    setStarted(started.filter((id) => !ended.some((job) => job.id === id)));
    setAnnouncement({
      jobId: last.id,
      ...(last.prompt ? { prompt: last.prompt } : {}),
      args: jobArgsText(last),
      word: last.status as "succeeded",
      at: dateTime.nowMillis(),
    });
  }, [jobs, started]);

  // An announcement shows for about three seconds.
  useEffect(() => {
    if (!announcement) return;
    const timer = globalThis.setTimeout(
      () => setAnnouncement(undefined),
      PromptJobsButton.ANNOUNCE_MS,
    );
    return () => globalThis.clearTimeout(timer);
  }, [announcement?.at]);

  if (!shown) return null;

  // The args as the list reads them (`#Q12 Fix the cart`), once it holds
  // the job; the run itself only knew their raw values.
  const announced = announcement
    ? jobs.find((job) => job.id === announcement.jobId)
    : undefined;
  const announcedArgs =
    announcement?.args ?? (announced ? jobArgsText(announced) : "");

  const counts = [
    running > 0 && tr("jobs.header.running", { args: [String(running)] }),
    queued > 0 && tr("jobs.header.queued", { args: [String(queued)] }),
  ]
    .filter(Boolean)
    .join(" · ");
  const label = tr("jobs.header.open");
  // A row opens the job in the side panel (#Q4515), which takes the right
  // of the page from the assistant.
  const openJob = (job: HostJobResource) => {
    setOpen(false);
    setSidePanel({ panel: "job" });
    setJobPanel({ jobId: job.id });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="minimal"
            aria-label={label}
            title={label}
            data-testid="jobs-header-button"
            data-in-flight={inFlight}
            className={cn(
              "relative h-9 min-w-9 gap-0 rounded-full px-2",
              "transition-[background-color,border-color,padding] duration-300 motion-reduce:transition-none",
              announcement && "bg-card border-border border px-3",
              announcement?.word === "succeeded" && "border-success",
              (announcement?.word === "failed" ||
                announcement?.word === "timed_out") &&
                "border-danger",
            )}
          />
        }
      >
        <span className="relative grid size-4 place-items-center">
          <Bot className="size-4" />
          {running > 0 && (
            <svg
              className="text-warning pointer-events-none absolute -inset-1.5 size-7 motion-safe:animate-spin"
              viewBox="0 0 36 36"
              aria-hidden="true"
              data-testid="jobs-header-ring"
            >
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="28 100"
              />
            </svg>
          )}
        </span>
        {inFlight > 0 && !announcement && (
          <span
            className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold"
            data-testid="jobs-header-count"
          >
            {inFlight}
          </span>
        )}
        {announcement && (
          <span
            className="ms-2 max-w-72 truncate text-xs font-medium"
            data-testid="jobs-header-announcement"
          >
            {titleOf(announcement.prompt)}
            {announcedArgs && (
              <span className="text-muted-foreground font-normal">
                {" "}
                {announcedArgs}
              </span>
            )}
            {" · "}
            {tr(JOB_HEADER_STATUS[announcement.word])}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 p-0"
        data-testid="jobs-header-popover"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="text-sm font-semibold">
            {tr("jobs.header.title")}
          </span>
          <span className="text-muted-foreground text-xs">
            {counts || tr("jobs.header.idle")}
          </span>
        </div>
        {listed.length > 0 && (
          <ul className="max-h-[28rem] overflow-y-auto">
            {listed.map((job) => (
              <PromptJobsRow
                key={job.id}
                job={job}
                title={titleOf(job.prompt) || job.kind}
                now={now}
                open={open}
                onOpen={openJob}
              />
            ))}
          </ul>
        )}
        <Link
          href={`/${slug}/settings/prompts/jobs`}
          className="text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 border-t px-3 py-2 text-xs"
          onClick={() => setOpen(false)}
          data-testid="jobs-header-all"
        >
          {tr("jobs.header.all")}
          <ArrowUpRight className="size-3" />
        </Link>
      </PopoverContent>
    </Popover>
  );
};

/**
 * How long an ended job stays listed: 15 minutes (#Q4514).
 */
PromptJobsButton.RECENT_MS = 15 * 60_000;

/**
 * How long the button says a job's name: about three seconds.
 */
PromptJobsButton.ANNOUNCE_MS = 3000;

export default PromptJobsButton;
