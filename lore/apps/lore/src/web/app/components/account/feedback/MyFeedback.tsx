import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CircleDot, FolderKanban, Search, Trash } from "lucide-react";
import { useEffect, useState } from "react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { MyFeedbackResource } from "@/api/schemas/myFeedbackResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import FilterSlot from "../../shared/FilterSlot.tsx";
import MyFeedbackEditSheet from "./MyFeedbackEditSheet.tsx";

/**
 * Filter shape for the reporter's feedback list — mirrors the project board
 * (search + status + a cross-project "project" filter). `projectId` is a
 * string in the form (Control values are strings) and coerced on fetch.
 */
const myFeedbackFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["pending", "accepted", "rejected"]).optional(),
  projectId: z.string().optional(),
});

const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive"> =
  {
    pending: "secondary",
    accepted: "default",
    rejected: "destructive",
  };

/**
 * `/me` page listing the feedback the current user submitted across every
 * project, with board-style filters. Pending feedback can be edited (inline
 * drawer) or withdrawn (soft-delete); triaged ones are read-only.
 */
const MyFeedback = () => {
  const feedbackApi = useClient<FeedbackController>();
  const dateFormatter = useInject(DateTimeProvider);
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();

  const [projectOptions, setProjectOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [editing, setEditing] = useState<MyFeedbackResource | undefined>(
    undefined,
  );
  // AlephaTable exposes `refresh` only through its row-action context, not via
  // a ref. Bumping this remount key refetches after a drawer save; filters /
  // sort survive the remount because they persist under `persistenceKey`.
  const [tableKey, setTableKey] = useState(0);

  useEffect(() => {
    feedbackApi
      .listMyFeedbackProjects()
      .then((res) =>
        setProjectOptions(
          res.items.map((c) => ({ label: c.title, value: String(c.id) })),
        ),
      )
      .catch(() => null);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/*
        `SettingsHeading`, not a hand-rolled `<h2>`: every other page in the
        `/account` rail titles itself through it, and this one used to carry a
        `text-base font-semibold` heading that made it the odd one out.
      */}
      <SettingsHeading
        title={String(tr("myFeedback.title"))}
        description={String(tr("myFeedback.description"))}
      />

      <AlephaTable<MyFeedbackResource>
        key={tableKey}
        className="min-h-0 flex-1"
        defaultSize={20}
        persistenceKey="lor.me.feedback"
        emptyMessage={String(tr("myFeedback.empty"))}
        filters={{
          schema: myFeedbackFiltersSchema,
          render: (form) => (
            <>
              <FilterSlot>
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={String(tr("myFeedback.filter.search"))}
                  inputProps={{
                    "aria-label": String(tr("myFeedback.filter.search.aria")),
                  }}
                />
              </FilterSlot>
              <div className="w-40">
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  icon={CircleDot}
                  clearLabel={String(tr("myFeedback.filter.allStatuses"))}
                  triggerClassName="w-full"
                  items={[
                    {
                      label: String(tr("feedback.status.pending")),
                      value: "pending",
                    },
                    {
                      label: String(tr("feedback.status.accepted")),
                      value: "accepted",
                    },
                    {
                      label: String(tr("feedback.status.rejected")),
                      value: "rejected",
                    },
                  ]}
                  inputProps={{
                    "aria-label": String(tr("myFeedback.column.status")),
                  }}
                />
              </div>
              {projectOptions.length > 0 && (
                <div className="w-48">
                  <Control
                    input={form.input.projectId}
                    label=""
                    clearable
                    icon={FolderKanban}
                    clearLabel={String(tr("myFeedback.filter.allProjects"))}
                    triggerClassName="w-full"
                    items={projectOptions}
                    inputProps={{
                      "aria-label": String(tr("myFeedback.column.project")),
                    }}
                  />
                </div>
              )}
            </>
          ),
        }}
        fetch={async ({ page, size, sort, filters: f }) =>
          feedbackApi.listMyFeedback({
            query: {
              page,
              size,
              sort,
              search: f?.search || undefined,
              status: f?.status || undefined,
              projectId: f?.projectId ? Number(f.projectId) : undefined,
            } as any,
          })
        }
        onRowClick={(p) => setEditing(p)}
        columns={{
          shortId: {
            label: "#",
            className: "pl-4",
            cell: (p: MyFeedbackResource) => (
              <span className="text-muted-foreground tabular-nums">
                #{p.shortId}
              </span>
            ),
          },
          project: {
            label: tr("myFeedback.column.project"),
            cell: (p: MyFeedbackResource) => (
              <span className="text-sm">{p.project.title}</span>
            ),
          },
          title: {
            label: tr("myFeedback.column.title"),
            sortable: true,
            // See ProjectQuestsTable: `w-full max-w-0` lets the column take
            // the space the others leave, so the ellipsis appears only when
            // the title genuinely does not fit, and `min-w-48` stops the pair
            // collapsing the column to zero once there is no space left.
            className: "w-full max-w-0 min-w-48",
            cell: (p: MyFeedbackResource) => (
              <span
                className="block truncate text-sm font-medium"
                title={p.title}
              >
                {p.title}
              </span>
            ),
          },
          status: {
            label: tr("myFeedback.column.status"),
            cell: (p: MyFeedbackResource) => (
              <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>
                {tr(`feedback.status.${p.status}`)}
              </Badge>
            ),
          },
          tags: {
            label: tr("myFeedback.column.tags"),
            cell: (p: MyFeedbackResource) =>
              p.tags && p.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {p.tags.map((tag: string) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          createdAt: {
            label: tr("myFeedback.column.created"),
            sortable: true,
            cell: (p: MyFeedbackResource) => (
              <span className="text-muted-foreground text-xs">
                {dateFormatter.of(p.createdAt).fromNow()}
              </span>
            ),
          },
        }}
        rowActions={(p) =>
          p.status === "pending"
            ? [
                {
                  icon: Trash,
                  label: String(tr("myFeedback.action.delete")),
                  destructive: true,
                  onClick: async (
                    _p: MyFeedbackResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    const confirmed = await dialog.confirm({
                      title: String(tr("myFeedback.delete.title")),
                      description: String(tr("myFeedback.delete.description")),
                      destructive: true,
                    });
                    if (!confirmed) return;
                    await feedbackApi.deleteMyFeedback({
                      params: { feedbackId: p.id },
                    });
                    refresh();
                  },
                },
              ]
            : []
        }
      />

      <MyFeedbackEditSheet
        feedback={editing}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setTableKey((k) => k + 1);
          setEditing(undefined);
        }}
      />
    </div>
  );
};

export default MyFeedback;
