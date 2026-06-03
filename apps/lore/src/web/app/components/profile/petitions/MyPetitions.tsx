import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { Pencil, Search, Trash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { MyPetitionResource } from "@/api/schemas/myPetitionResourceSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import MyPetitionEditSheet from "./MyPetitionEditSheet.tsx";

/**
 * Filter shape for the reporter's petition list — mirrors the campaign board
 * (search + status + a cross-campaign "campaign" filter). `campaignId` is a
 * string in the form (Control values are strings) and coerced on fetch.
 */
const myPetitionsFiltersSchema = t.object({
  search: t.optional(t.string()),
  status: t.optional(t.enum(["pending", "accepted", "rejected"])),
  campaignId: t.optional(t.string()),
});

const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive"> =
  {
    pending: "secondary",
    accepted: "default",
    rejected: "destructive",
  };

/**
 * `/me` page listing the petitions the current user submitted across every
 * campaign, with board-style filters. Pending petitions can be edited (inline
 * drawer) or withdrawn (soft-delete); triaged ones are read-only.
 */
const MyPetitions = () => {
  const petitionApi = useClient<PetitionController>();
  const router = useRouter<AppRouter>();
  const dateFormatter = useInject(DateTimeProvider);
  const dialog = useDialog();

  const [campaignOptions, setCampaignOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [editing, setEditing] = useState<MyPetitionResource | undefined>(
    undefined,
  );
  // Captured from the row action so the edit drawer can refresh the table
  // after a successful save.
  const refreshRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    petitionApi
      .listMyPetitionCampaigns()
      .then((res) =>
        setCampaignOptions(
          res.items.map((c) => ({ label: c.title, value: String(c.id) })),
        ),
      )
      .catch(() => null);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">Petitions</h2>
        <p className="text-muted-foreground text-xs">
          Feedback and requests you submitted across campaigns. Pending ones can
          be edited or withdrawn.
        </p>
      </div>

      <AlephaTable<MyPetitionResource>
        className="min-h-0 flex-1"
        defaultSize={20}
        persistenceKey="lor.me.petitions"
        emptyMessage="You haven't submitted any petitions yet."
        filters={{
          schema: myPetitionsFiltersSchema,
          render: (form) => (
            <>
              <div className="w-44">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder="Search"
                  inputProps={{ "aria-label": "Search petitions" }}
                />
              </div>
              <div className="w-40">
                <Control
                  input={form.input.status}
                  label=""
                  clearable
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
              {campaignOptions.length > 0 && (
                <div className="w-48">
                  <Control
                    input={form.input.campaignId}
                    label=""
                    clearable
                    clearLabel="All campaigns"
                    triggerClassName="w-full"
                    items={campaignOptions}
                    inputProps={{ "aria-label": "Campaign" }}
                  />
                </div>
              )}
            </>
          ),
        }}
        fetch={async ({ page, size, sort, filters: f }) =>
          petitionApi.listMyPetitions({
            query: {
              page,
              size,
              sort,
              search: f?.search || undefined,
              status: f?.status || undefined,
              campaignId: f?.campaignId ? Number(f.campaignId) : undefined,
            } as any,
          })
        }
        onRowClick={(p) =>
          router.push("campaignPetitionStatus", {
            params: {
              campaignId: String(p.campaignId),
              petitionId: String(p.id),
            },
          })
        }
        columns={{
          shortId: {
            label: "#",
            className: "pl-4",
            cell: (p: MyPetitionResource) => (
              <span className="text-muted-foreground tabular-nums">
                #{p.shortId}
              </span>
            ),
          },
          campaign: {
            label: "Campaign",
            cell: (p: MyPetitionResource) => (
              <span className="text-sm">{p.campaign.title}</span>
            ),
          },
          title: {
            label: "Title",
            sortable: true,
            cell: (p: MyPetitionResource) => (
              <span className="text-sm font-medium" title={p.title}>
                {p.title.length > 60 ? `${p.title.slice(0, 60)}…` : p.title}
              </span>
            ),
          },
          status: {
            label: "Status",
            cell: (p: MyPetitionResource) => (
              <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>
                {p.status}
              </Badge>
            ),
          },
          tags: {
            label: "Tags",
            cell: (p: MyPetitionResource) =>
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
            cell: (p: MyPetitionResource) => (
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
                  icon: Pencil,
                  label: "Edit",
                  onClick: (
                    _p: MyPetitionResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    refreshRef.current = refresh;
                    setEditing(p);
                  },
                },
                {
                  icon: Trash,
                  label: "Delete",
                  destructive: true,
                  onClick: async (
                    _p: MyPetitionResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    const confirmed = await dialog.confirm({
                      title: "Delete petition?",
                      description:
                        "This permanently withdraws your petition. This cannot be undone.",
                      destructive: true,
                    });
                    if (!confirmed) return;
                    await petitionApi.deleteMyPetition({
                      params: { petitionId: p.id },
                    });
                    refresh();
                  },
                },
              ]
            : []
        }
      />

      <MyPetitionEditSheet
        petition={editing}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          refreshRef.current?.();
          setEditing(undefined);
        }}
      />
    </div>
  );
};

export default MyPetitions;
