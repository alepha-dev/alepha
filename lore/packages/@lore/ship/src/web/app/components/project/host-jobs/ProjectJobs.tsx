import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import { DataTable } from "@alepha/ui/table";
import type { HostJobResource } from "@lore/core/schemas";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useState } from "react";

import type { HostJobController } from "../../../../../api/controllers/HostJobController.ts";
import JobStatusBadge from "./JobStatusBadge.tsx";

/**
 * The project's host jobs, newest first (#Q3984): agent jobs and Agent host
 * checks, what each was about, where it ran and how it ended. Polled every
 * few seconds while one is in flight.
 */
const ProjectJobs = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<HostJobController>();
  const [project] = useStore(currentProjectAtom);
  const [polling, setPolling] = useState(false);

  const { data } = useQuery(
    {
      enabled: Boolean(project),
      key: ["host-jobs", project?.id],
      keepPreviousData: true,
      runEvery: polling ? 3000 : undefined,
      handler: async () => {
        if (!project) return undefined;
        const page = await api.listProjectJobs({
          params: { projectId: project.id },
          query: {},
        });
        setPolling(
          page.items.some(
            (job) => job.status === "queued" || job.status === "running",
          ),
        );
        return page;
      },
    },
    [project?.id, polling],
  );
  if (!project) return null;
  const slug = project.slug ?? String(project.id);

  return (
    <AccountPage variant="table">
      <DataTable<HostJobResource>
        className="min-h-0 flex-1"
        data={data?.items ?? []}
        emptyState={{
          title: tr("jobs.empty"),
          description: tr("jobs.empty.description"),
        }}
        columns={{
          queuedAt: {
            label: tr("jobs.col.when"),
            sortable: true,
            cell: (job) => (
              <Link
                href={`/${slug}/jobs/${job.id}`}
                className={cn(textLinkUnderlineClassName, "text-xs")}
              >
                {l(job.queuedAt, { date: "lll" })}
              </Link>
            ),
          },
          kind: {
            label: tr("jobs.col.kind"),
            sortable: true,
            cell: (job) => (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{job.kind}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {job.subjectType
                    ? `${job.subjectType} ${job.subjectId ?? ""}`
                    : job.input.profile}
                </span>
              </span>
            ),
          },
          status: {
            label: tr("jobs.col.status"),
            sortable: false,
            cell: (job) => <JobStatusBadge status={job.status} />,
          },
          hostSlug: {
            label: tr("jobs.col.host"),
            sortable: true,
            cell: (job) => (
              <span className="text-muted-foreground text-xs">
                {job.hostSlug ?? ""}
              </span>
            ),
          },
          startedByName: {
            label: tr("jobs.col.by"),
            sortable: true,
            cell: (job) => (
              <span className="text-muted-foreground truncate text-xs">
                {job.startedByName ?? ""}
              </span>
            ),
          },
        }}
      />
    </AccountPage>
  );
};

export default ProjectJobs;
