import { TimeAgo, Badge, useDialog } from "@alepha/ui";
import { SettingsHeading } from "@alepha/ui/settings";
import { AlephaTable, type AlephaTableFilterFields } from "@alepha/ui/table";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CircleDot, FolderKanban, Trash } from "lucide-react";
import { useEffect, useState } from "react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { MyFeedbackResource } from "@/api/schemas/myFeedbackResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";
import MyFeedbackEditSheet from "./MyFeedbackEditSheet.tsx";

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

  /**
   * The reporter's filters, mirroring the project board: search, status and a
   * cross-project "project" filter. `projectId` is a string, as a select's
   * value is, and coerced on fetch.
   */
  const filterFields = {
    search: {
      preset: "search",
      control: {
        inputProps: { "aria-label": tr("myFeedback.filter.search.aria") },
      },
    },
    /**
     * An ARRAY, and empty means every status (feedback #2092). Three real
     * states, so a multi-select earns its keep: "accepted or rejected" is a
     * question a reporter asks and a single value could not express.
     *
     * Hand-written rather than the entity's enum: the entity declares it
     * inline, and the web must not import an entity.
     */
    status: {
      schema: z.array(z.enum(["pending", "accepted", "rejected"])),
      label: tr("myFeedback.column.status"),
      icon: CircleDot,
      items: [
        { label: tr("feedback.status.pending"), value: "pending" },
        { label: tr("feedback.status.accepted"), value: "accepted" },
        { label: tr("feedback.status.rejected"), value: "rejected" },
      ],
      control: {
        clearLabel: tr("myFeedback.filter.allStatuses"),
        countLabel: (n: number) =>
          tr("myFeedback.filter.statusCount", { args: [String(n)] }),
      },
    },
    projectId: {
      schema: z.string(),
      label: tr("myFeedback.column.project"),
      icon: FolderKanban,
      items: projectOptions,
      hidden: projectOptions.length === 0,
      control: { clearLabel: tr("myFeedback.filter.allProjects") },
    },
  } satisfies AlephaTableFilterFields;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/*
        `SettingsHeading`, not a hand-rolled `<h2>`: every other page in the
        `/account` rail titles itself through it, and this one used to carry a
        `text-base font-semibold` heading that made it the odd one out.
      */}
      <SettingsHeading
        title={tr("myFeedback.title")}
        description={tr("myFeedback.description")}
      />

      <AlephaTable<MyFeedbackResource, typeof filterFields>
        key={tableKey}
        className="min-h-0 flex-1"
        persistenceKey="lor.me.feedback"
        emptyMessage={tr("myFeedback.empty")}
        filters={{ fields: filterFields }}
        fetch={async ({ page, size, sort, filters: f }) =>
          feedbackApi.listMyFeedback({
            query: {
              page,
              size,
              sort,
              search: f?.search || undefined,
              // Comma-joined, the way every list filter reaches the server:
              // `parseQueryString` returns `Record<string, string>`, so a
              // repeated key would keep only the last value.
              status: f?.status?.length ? f.status.join(",") : undefined,
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
                {formatReference("feedback", p.shortId)}
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
              <TimeAgo
                value={p.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
        }}
        rowActions={(p) =>
          p.status === "pending"
            ? [
                {
                  icon: Trash,
                  label: tr("myFeedback.action.delete"),
                  destructive: true,
                  onClick: async (
                    _p: MyFeedbackResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    const confirmed = await dialog.confirm({
                      title: tr("myFeedback.delete.title"),
                      description: tr("myFeedback.delete.description"),
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
