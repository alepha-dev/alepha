import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { CircleDot, FolderKanban, Search, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { MyFeedbackResource } from "@/api/schemas/myFeedbackResourceSchema.ts";
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
        title="Submitted feedback"
        description="Bug reports and requests you submitted across projects. Pending ones can still be edited or withdrawn."
      />

      <AlephaTable<MyFeedbackResource>
        key={tableKey}
        className="min-h-0 flex-1"
        defaultSize={20}
        persistenceKey="lor.me.feedback"
        emptyMessage="You haven't submitted any feedback yet."
        filters={{
          schema: myFeedbackFiltersSchema,
          render: (form) => (
            <>
              <div className="w-44">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder="Search"
                  inputProps={{ "aria-label": "Search feedback" }}
                />
              </div>
              <div className="w-40">
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  icon={CircleDot}
                  clearLabel="All statuses"
                  triggerClassName="w-full"
                  items={[
                    { label: "Pending", value: "pending" },
                    { label: "Accepted", value: "accepted" },
                    { label: "Rejected", value: "rejected" },
                  ]}
                  inputProps={{ "aria-label": "Status" }}
                />
              </div>
              {projectOptions.length > 0 && (
                <div className="w-48">
                  <Control
                    input={form.input.projectId}
                    label=""
                    clearable
                    icon={FolderKanban}
                    clearLabel="All projects"
                    triggerClassName="w-full"
                    items={projectOptions}
                    inputProps={{ "aria-label": "Project" }}
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
            label: "Project",
            cell: (p: MyFeedbackResource) => (
              <span className="text-sm">{p.project.title}</span>
            ),
          },
          title: {
            label: "Title",
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
            label: "Status",
            cell: (p: MyFeedbackResource) => (
              <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>
                {p.status}
              </Badge>
            ),
          },
          tags: {
            label: "Tags",
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
            label: "Created",
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
                  label: "Delete",
                  destructive: true,
                  onClick: async (
                    _p: MyFeedbackResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    const confirmed = await dialog.confirm({
                      title: "Delete feedback?",
                      description:
                        "This permanently withdraws your feedback. This cannot be undone.",
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
