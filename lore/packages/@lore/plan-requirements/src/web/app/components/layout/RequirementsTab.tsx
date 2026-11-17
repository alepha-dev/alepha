import { Badge, Button } from "@alepha/ui";
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
import { useRouter, useRouterState } from "alepha/react/router";
import { FileInput, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import RequirementDetail from "../requirements/RequirementDetail.tsx";
import {
  REQUIREMENT_PRIORITY_LABEL_KEYS,
  REQUIREMENT_STATUS_LABEL_KEYS,
  REQUIREMENT_TYPE_LABEL_KEYS,
} from "../requirements/requirementLabels.ts";
import RequirementSheet from "../requirements/RequirementSheet.tsx";
import RequirementStatusChips from "../requirements/RequirementStatusChips.tsx";
import VerifyDialog from "../verify/VerifyDialog.tsx";

const TYPES = ["functional", "non_functional", "constraint"] as const;
const STATUSES = [
  "verified",
  "failing",
  "in_development",
  "covered",
  "not_covered",
] as const;

/**
 * The Requirements tab of the Requirements page (#E153): counters, type,
 * verified-by and release filters, the list grouped by chapter, the detail
 * pane of the selected requirement (`?requirement=15`), a banner naming the
 * requirements whose source changed, and the List / Matrix switch (the
 * matrix arrives with traceability).
 */
const RequirementsTab = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  const queries = useQueryClient();
  // This package's own page, named by string.
  const router = useRouter<any>();
  const routerState = useRouterState();
  const projectId = project?.id ?? 0;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const selected = Number(
    (routerState.query as Record<string, string> | undefined)?.requirement ?? 0,
  );

  const list = useQuery<RequirementResource[]>(
    {
      key: ["requirements", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await api.getRequirements({ params: { projectId }, query: {} }),
    },
    [api, projectId],
  );
  const releases = useQuery<
    Array<{ id: number; tag?: string; title?: string }>
  >(
    {
      key: ["requirements-releases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await api.getRequirementReleases({ params: { projectId } }),
    },
    [api, projectId],
  );

  const filters = useForm({
    id: "requirement-filters",
    schema: z.object({
      view: z.enum(["list", "matrix"]),
      status: z.text(),
      type: z.text(),
      verifiedBy: z.text(),
      release: z.text(),
    }),
    initialValues: {
      view: "list" as const,
      status: "",
      type: "",
      verifiedBy: "",
      release: "",
    },
    handler: async () => {},
  });
  const values = useFormValues(filters);

  if (!project) return null;
  const all = list.data ?? [];
  const rows = all.filter(
    (it) =>
      (!values.status || it.status === values.status) &&
      (!values.type || it.type === values.type) &&
      (!values.verifiedBy ||
        (values.verifiedBy === "usecases"
          ? it.criteria.length > 0
          : it.criteria.length === 0)) &&
      (!values.release ||
        String(it.targetRelease?.id ?? "") === values.release),
  );
  const chapters = new Map<string, RequirementResource[]>();
  for (const row of rows) {
    const key = row.chapter ?? "";
    chapters.set(key, [...(chapters.get(key) ?? []), row]);
  }
  const changed = all.filter((it) => it.sourceChanged);
  const current = all.find((it) => it.number === selected);
  const canWrite = canInProject(project, "requirement:write");
  const select = (number?: number) =>
    void router.push("projectRequirements", {
      params: { projectSlug: project.slug },
      query: number ? { requirement: String(number) } : {},
    });
  // The pane reads the list's row, so a write refreshes the list.
  const refresh = (_next?: RequirementResource) => {
    queries.invalidate(["requirements", projectId]);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        <form {...filters.props} className="flex flex-col gap-3 border-b p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Control
              input={filters.input.status}
              segmented
              items={[
                {
                  value: "",
                  label: `${all.length} ${tr("requirements.requirement.counter.all")}`,
                },
                ...STATUSES.map((it) => ({
                  value: it,
                  label: `${all.filter((row) => row.status === it).length} ${tr(REQUIREMENT_STATUS_LABEL_KEYS[it])}`,
                })),
              ]}
            />
            <div className="flex-1" />
            <Control
              input={filters.input.view}
              segmented
              items={[
                {
                  value: "list",
                  label: tr("requirements.requirement.view.list"),
                },
                {
                  value: "matrix",
                  label: tr("requirements.requirement.view.matrix"),
                },
              ]}
            />
            {canWrite ? (
              <Button
                type="button"
                variant="outlined"
                onClick={() => setImporting(true)}
              >
                <FileInput className="size-4" />
                {tr("requirements.requirement.import")}
              </Button>
            ) : null}
            {canWrite ? (
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {tr("project.menu.create-requirement")}
              </Button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Control
              label={tr("requirements.requirement.field.type")}
              input={filters.input.type}
              select
              items={[
                {
                  value: "",
                  label: tr("requirements.requirement.filter.anyType"),
                },
                ...TYPES.map((it) => ({
                  value: it,
                  label: tr(REQUIREMENT_TYPE_LABEL_KEYS[it]),
                })),
              ]}
            />
            <Control
              label={tr("requirements.requirement.verifiedByFilter")}
              input={filters.input.verifiedBy}
              select
              items={[
                {
                  value: "",
                  label: tr("requirements.requirement.filter.anyVerification"),
                },
                {
                  value: "usecases",
                  label: tr("requirements.requirement.filter.useCases"),
                },
                {
                  value: "none",
                  label: tr("requirements.requirement.filter.nothing"),
                },
              ]}
            />
            <Control
              label={tr("requirements.requirement.release")}
              input={filters.input.release}
              select
              items={[
                {
                  value: "",
                  label: tr("requirements.requirement.filter.allReleases"),
                },
                ...(releases.data ?? []).map((r) => ({
                  value: String(r.id),
                  label: r.tag ?? r.title ?? "",
                })),
              ]}
            />
          </div>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {changed.length ? (
            <div
              className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
              data-testid="source-changed-banner"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {tr("requirements.requirement.banner", {
                  args: [
                    changed
                      .map((it) => formatReference("requirement", it.number))
                      .join(", "),
                  ],
                })}
              </span>
            </div>
          ) : null}
          {values.view === "matrix" ? null : list.data && rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr(
                all.length === 0
                  ? "requirements.requirement.empty"
                  : "requirements.requirement.emptyFilter",
              )}
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="requirements-table">
              <thead className="text-muted-foreground text-left text-xs">
                <tr className="border-b">
                  <th className="py-2 font-medium">
                    {tr("requirements.requirement.col.requirement")}
                  </th>
                  <th className="py-2 font-medium">
                    {tr("requirements.requirement.field.type")}
                  </th>
                  <th className="py-2 font-medium">
                    {tr("requirements.requirement.field.priority")}
                  </th>
                  <th className="py-2 font-medium">
                    {tr("requirements.requirement.release")}
                  </th>
                  <th className="py-2 font-medium">
                    {tr("requirements.requirement.col.verifiedBy")}
                  </th>
                  <th className="py-2 font-medium">
                    {tr("requirements.requirement.col.status")}
                  </th>
                </tr>
              </thead>
              {[...chapters].map(([chapter, group]) => (
                <tbody key={chapter || "none"}>
                  <tr className="bg-muted/40 border-b">
                    <td colSpan={6} className="py-1.5 text-xs font-semibold">
                      {chapter || tr("requirements.requirement.noChapter")}
                    </td>
                  </tr>
                  {group.map((row) => (
                    <tr
                      key={row.id}
                      data-testid="requirement-row"
                      className={`hover:bg-muted/30 cursor-pointer border-b ${row.number === selected ? "bg-muted/50" : ""}`}
                      onClick={() => select(row.number)}
                    >
                      <td className="py-2 pr-3">
                        <span className="font-semibold">
                          {formatReference("requirement", row.number)}
                        </span>{" "}
                        {row.statement}
                        {row.paragraph ? (
                          <span className="text-muted-foreground text-xs">
                            {" "}
                            §{row.paragraph}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        {tr(REQUIREMENT_TYPE_LABEL_KEYS[row.type])}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="tint">
                          {tr(REQUIREMENT_PRIORITY_LABEL_KEYS[row.priority])}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        {row.targetRelease ? (
                          <span>
                            {row.targetRelease.tag ?? row.targetRelease.title}{" "}
                            <span className="text-muted-foreground text-xs">
                              {tr(
                                row.targetRelease.mode === "auto"
                                  ? "requirements.requirement.release.autoShort"
                                  : "requirements.requirement.release.byHandShort",
                              )}
                            </span>
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.criteria.length
                          ? row.criteria
                              .map(
                                (c) =>
                                  `${formatReference("usecase", c.useCaseNumber)} ${c.key}`,
                              )
                              .join(" · ")
                          : "-"}
                      </td>
                      <td className="py-2">
                        <RequirementStatusChips requirement={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </div>
      </div>
      {current ? (
        <aside className="w-96 shrink-0 overflow-y-auto border-l">
          <RequirementDetail
            key={current.id}
            requirement={current}
            releases={releases.data ?? []}
            onChange={(next) => refresh(next)}
            onEdit={() => setEditing(true)}
            onDeleted={() => {
              select(undefined);
              refresh();
            }}
          />
        </aside>
      ) : null}
      <VerifyDialog
        subject={{ kind: "import" }}
        open={importing}
        onOpenChange={setImporting}
      />
      <RequirementSheet
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onSubmit={(saved) => {
          setCreating(false);
          refresh();
          select(saved.number);
        }}
      />
      {current ? (
        <RequirementSheet
          key={`edit-${current.id}`}
          projectId={projectId}
          requirement={current}
          open={editing}
          onOpenChange={setEditing}
          onSubmit={(saved) => {
            setEditing(false);
            refresh(saved);
          }}
        />
      ) : null}
    </div>
  );
};

export default RequirementsTab;
