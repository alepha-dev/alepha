import { Button, Progress, Segmented } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  canInProject,
  currentProjectAtom,
  formatReference,
  type I18n,
} from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ChevronDown, ChevronRight, ClipboardCheck, Plus } from "lucide-react";
import { useState } from "react";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import ActorAvatars from "../usecases/ActorAvatars.tsx";
import {
  developmentOf,
  groupUseCases,
  type UseCaseGrouping,
} from "../usecases/groupUseCases.ts";
import RunStateBadge from "../usecases/RunStateBadge.tsx";
import { USE_CASE_STATUS_LABEL_KEYS } from "../usecases/useCaseLabels.ts";
import UseCaseSheet from "../usecases/UseCaseSheet.tsx";
import UseCaseStatusBadge from "../usecases/UseCaseStatusBadge.tsx";
import VerifyDialog from "../verify/VerifyDialog.tsx";

const STATUSES = ["draft", "ready", "validated", "deprecated"] as const;

const RUN_COUNTER_KEYS = {
  passed: "requirements.run.state.passed",
  failed: "requirements.run.state.failed",
  in_development: "requirements.run.state.in_development",
  never_run: "requirements.run.state.never_run",
} as const;

const GROUP_LABEL_KEYS = {
  epic: "requirements.usecase.groupBy.epic",
  persona: "requirements.usecase.groupBy.persona",
  status: "requirements.usecase.groupBy.status",
  none: "requirements.usecase.groupBy.none",
} as const;

/**
 * The Use cases tab of the Requirements page (#E153): counters that filter,
 * persona and status filters, group by epic (the default), persona, status
 * or none, collapsible groups, and one row per use case. The run columns
 * (last result, environments, Verify) arrive with the quests that bring
 * runs.
 */
const UseCasesTab = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const useCaseApi = useClient<UseCaseController>();
  const queries = useQueryClient();
  // Pages of this package, named by string.
  const router = useRouter<any>();
  const projectId = project?.id ?? 0;
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const useCases = useQuery<UseCaseResource[]>(
    {
      key: ["use-cases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await useCaseApi.getUseCases({ params: { projectId }, query: {} }),
    },
    [useCaseApi, projectId],
  );

  const [counter, setCounter] = useState("all");
  const filters = useForm({
    id: "use-case-filters",
    schema: z.object({
      persona: z.text().optional(),
      status: z.text().optional(),
      group: z.enum(["epic", "persona", "status", "none"]).optional(),
    }),
    initialValues: {
      persona: "all",
      status: "all",
      group: "epic" as const,
    },
    handler: async () => {},
  });
  const values = useFormValues(filters);
  const persona =
    values.persona && values.persona !== "all" ? values.persona : "";
  const status = values.status && values.status !== "all" ? values.status : "";

  if (!project) return null;
  const all = useCases.data ?? [];
  const personas = [
    ...new Map(
      all.flatMap((it) => it.actors).map((a) => [a.number, a]),
    ).values(),
  ].sort((a, b) => a.number - b.number);
  const rows = all.filter(
    (it) =>
      (counter === "all" ||
        (counter === "stale" ? it.stale : it.state === counter)) &&
      (!status || it.status === status) &&
      (!persona || it.actors.some((a) => String(a.number) === persona)),
  );
  const groups = groupUseCases(
    rows,
    (values.group ?? "epic") as UseCaseGrouping,
  );
  const counters = [
    {
      key: "all",
      label: tr("requirements.usecase.counter.all"),
      count: all.length,
    },
    ...(["passed", "failed", "in_development", "never_run"] as const).map(
      (it) => ({
        key: it,
        label: tr(RUN_COUNTER_KEYS[it]),
        count: all.filter((row) => row.state === it).length,
      }),
    ),
    {
      key: "stale",
      label: tr("requirements.run.stale"),
      count: all.filter((row) => row.stale).length,
    },
  ];
  const canWrite = canInProject(project, "usecase:write");
  const hrefOf = (row: UseCaseResource) =>
    router.path("projectUseCase", {
      params: { projectSlug: project.slug, useCaseNumber: String(row.number) },
    });
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        {...filters.props}
        className="[&_:is(input,[role=combobox])]:bg-background chrome flex flex-col gap-3 border-b p-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            size="sm"
            value={counter}
            onChange={setCounter}
            options={counters.map((it) => ({
              value: it.key,
              label: `${it.count} ${it.label}`,
            }))}
          />
          <div className="flex-1" />
          <Button
            type="button"
            variant="outlined"
            onClick={() => setVerifying(true)}
          >
            <ClipboardCheck className="size-4" />
            {tr("requirements.verify.allStale", {
              args: [String(all.filter((row) => row.stale).length)],
            })}
          </Button>
          {canWrite ? (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              {tr("project.menu.create-usecase")}
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Control
            label={tr("requirements.usecase.filter.persona")}
            input={filters.input.persona}
            select
            items={[
              {
                value: "all",
                label: tr("requirements.usecase.filter.anyPersona"),
              },
              ...personas.map((p) => ({
                value: String(p.number),
                label: `${formatReference("persona", p.number)} ${p.name}`,
              })),
            ]}
          />
          <Control
            label={tr("requirements.usecase.filter.status")}
            input={filters.input.status}
            select
            items={[
              {
                value: "all",
                label: tr("requirements.usecase.filter.anyStatus"),
              },
              ...STATUSES.map((it) => ({
                value: it,
                label: tr(USE_CASE_STATUS_LABEL_KEYS[it]),
              })),
            ]}
          />
          <Control
            label={tr("requirements.usecase.groupBy")}
            input={filters.input.group}
            select
            items={(["epic", "persona", "status", "none"] as const).map(
              (it) => ({
                value: it,
                label: tr(GROUP_LABEL_KEYS[it]),
              }),
            )}
          />
        </div>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {useCases.data && rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr(
              all.length === 0
                ? "requirements.usecase.empty"
                : "requirements.usecase.emptyFilter",
            )}
          </p>
        ) : (
          <table className="w-full text-sm" data-testid="use-cases-table">
            <thead className="text-muted-foreground text-left text-xs">
              <tr className="border-b">
                <th className="py-2 font-medium">
                  {tr("requirements.usecase.col.useCase")}
                </th>
                <th className="py-2 font-medium">
                  {tr("requirements.usecase.col.actors")}
                </th>
                <th className="py-2 font-medium">
                  {tr("requirements.usecase.col.status")}
                </th>
                <th className="py-2 font-medium">
                  {tr("requirements.usecase.col.development")}
                </th>
                <th className="py-2 font-medium">
                  {tr("requirements.run.lastResult")}
                </th>
              </tr>
            </thead>
            {groups.map((group) => {
              const open = !collapsed.has(group.key);
              return (
                <tbody key={group.key} data-testid="use-case-group">
                  {group.kind !== "none" ? (
                    <tr className="bg-muted/40 border-b">
                      <td colSpan={5} className="py-1.5">
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-xs font-semibold"
                          aria-expanded={open}
                          onClick={() => toggle(group.key)}
                        >
                          {open ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                          {group.kind === "epic"
                            ? `${formatReference("epic", group.number ?? 0)} ${group.label}`
                            : group.kind === "persona"
                              ? `${formatReference("persona", group.number ?? 0)} ${group.label}`
                              : group.kind === "status"
                                ? tr(
                                    USE_CASE_STATUS_LABEL_KEYS[
                                      group.label as (typeof STATUSES)[number]
                                    ],
                                  )
                                : tr("requirements.usecase.group.unplanned")}
                          <span className="text-muted-foreground font-normal">
                            ·{" "}
                            {tr("requirements.usecase.group.count", {
                              args: [String(group.rows.length)],
                            })}
                            {group.progress
                              ? ` · ${tr("requirements.usecase.development", { args: [String(group.progress.completed), String(group.progress.total)] })}`
                              : ""}
                          </span>
                        </button>
                      </td>
                    </tr>
                  ) : null}
                  {open
                    ? group.rows.map((row) => {
                        const dev = developmentOf(row);
                        return (
                          <tr
                            key={`${group.key}:${row.id}`}
                            className="border-b"
                            data-testid="use-case-row"
                          >
                            <td className="py-2 pr-3">
                              <Link
                                href={hrefOf(row)}
                                className="hover:underline"
                              >
                                <span className="font-semibold">
                                  {formatReference("usecase", row.number)}
                                </span>{" "}
                                {row.title}
                              </Link>
                            </td>
                            <td className="py-2 pr-3">
                              <ActorAvatars actors={row.actors} />
                            </td>
                            <td className="py-2 pr-3">
                              <UseCaseStatusBadge status={row.status} />
                            </td>
                            <td className="py-2">
                              {dev ? (
                                <div className="flex items-center gap-2">
                                  <Progress
                                    className="w-20"
                                    value={
                                      dev.total
                                        ? Math.round(
                                            (dev.completed / dev.total) * 100,
                                          )
                                        : 0
                                    }
                                  />
                                  <span className="text-muted-foreground text-xs">
                                    {tr("requirements.usecase.development", {
                                      args: [
                                        String(dev.completed),
                                        String(dev.total),
                                      ],
                                    })}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">
                                  {tr("requirements.usecase.noEpic")}
                                </span>
                              )}
                            </td>
                            <td className="py-2">
                              <RunStateBadge
                                state={row.state}
                                stale={row.stale}
                              />
                            </td>
                          </tr>
                        );
                      })
                    : null}
                </tbody>
              );
            })}
          </table>
        )}
      </div>
      <VerifyDialog
        subject={{ kind: "allStale" }}
        open={verifying}
        onOpenChange={setVerifying}
      />
      <UseCaseSheet
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onSubmit={() => {
          setCreating(false);
          queries.invalidate(["use-cases", projectId]);
        }}
      />
    </div>
  );
};

export default UseCasesTab;
