import type {
  MemberController,
  OrganizationRankController,
  OrganizationRankResource,
} from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { useAction, useClient, useInject, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { PermissionCatalogue } from "alepha/security";
import { Plus, Save } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import { Card } from "../core/Card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { cn } from "../core/utils.ts";
import { settingsCardEdge } from "../settings/settingsCardEdge.ts";
import {
  PermissionMatrix,
  type PermissionMatrixColumn,
  type PermissionMatrixGroup,
} from "../table/PermissionMatrix.tsx";
import { OrganizationRankColumnHeader } from "./OrganizationRankColumnHeader.tsx";

type CatalogueGroup = PermissionCatalogue["groups"][number];
type CataloguePermission = CatalogueGroup["permissions"][number];

export interface OrganizationRankPreset {
  key: string;
  name: string;
  permissions: string[];
}

export interface OrganizationRanksProps {
  organizationId: string;
  presets?: OrganizationRankPreset[];
  filterPermission?: (
    permission: CataloguePermission,
    group: CatalogueGroup,
  ) => boolean;
  lockPermission?: (
    permission: CataloguePermission,
    group: CatalogueGroup,
  ) => "on" | "off" | undefined;
  label?: (key: string | undefined, fallback: string) => string;
}

export const OrganizationRanks = (props: OrganizationRanksProps) => {
  const api = useClient<OrganizationRankController>();
  const membersApi = useClient<MemberController>();
  const dateTime = useInject(DateTimeProvider);
  const dialog = useDialog();
  const toaster = useToast();
  const { tr } = useI18n();
  const invalidates = [["organization-ranks", props.organizationId]];

  const ranksQuery = useQuery(
    {
      key: ["organization-ranks", props.organizationId],
      handler: () =>
        api.getOrganizationRanks({
          params: { organizationId: props.organizationId },
        }),
    },
    [api, props.organizationId],
  );
  const catalogueQuery = useQuery(
    {
      handler: () =>
        api.getOrganizationRankCatalogue({
          params: { organizationId: props.organizationId },
        }),
    },
    [api, props.organizationId],
  );
  const membersQuery = useQuery(
    {
      handler: () =>
        membersApi.getOrganizationMembers({
          params: { organizationId: props.organizationId },
        }),
    },
    [membersApi, props.organizationId],
  );
  const rankResponse = ranksQuery.data?.items;
  const ranks = rankResponse ?? [];
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [seededFrom, setSeededFrom] = useState<OrganizationRankResource[]>();
  if (rankResponse && rankResponse !== seededFrom) {
    setSeededFrom(rankResponse);
    setDraft(organizationRankDraft(rankResponse));
  }

  const save = useAction<[], void>(
    {
      handler: async () => {
        for (const rank of ranks) {
          if (!rank.editable) continue;
          const permissions = draft[rank.key] ?? [];
          if (samePermissions(permissions, rank.permissions)) continue;
          await api.saveOrganizationRank({
            params: { organizationId: props.organizationId, key: rank.key },
            body: { name: rank.name, permissions },
          });
        }
        toaster.success(
          tr("organizations.ranks.saved", { default: "Ranks saved" }),
        );
      },
      invalidates,
    },
    [api, draft, props.organizationId, ranks, toaster, tr],
  );
  const create = useAction<[OrganizationRankPreset | undefined], void>(
    {
      handler: async (preset) => {
        const name = await dialog.prompt({
          title: tr("organizations.ranks.createTitle", {
            default: "Create a rank",
          }),
          description: tr("organizations.ranks.createDescription", {
            default: "Name the rank. Its key stays stable when renamed.",
          }),
          confirmLabel: tr("organizations.ranks.createConfirm", {
            default: "Create",
          }),
          defaultValue: preset?.name ?? "",
        });
        if (!name?.trim()) return;
        await api.saveOrganizationRank({
          params: {
            organizationId: props.organizationId,
            key: `r${dateTime.nowMillis().toString(36)}`,
          },
          body: {
            name: name.trim(),
            permissions: preset?.permissions ?? [],
          },
        });
      },
      invalidates,
    },
    [api, dateTime, dialog, props.organizationId, tr],
  );
  const rename = useAction<[OrganizationRankResource], void>(
    {
      handler: async (rank) => {
        const name = await dialog.prompt({
          title: tr("organizations.ranks.renameTitle", {
            default: "Rename $1",
            args: [rank.name],
          }),
          confirmLabel: tr("organizations.ranks.rename", {
            default: "Rename",
          }),
          defaultValue: rank.name,
        });
        if (!name?.trim() || name.trim() === rank.name) return;
        await api.saveOrganizationRank({
          params: { organizationId: props.organizationId, key: rank.key },
          body: {
            name: name.trim(),
            permissions: draft[rank.key] ?? rank.permissions,
          },
        });
      },
      invalidates,
    },
    [api, dialog, draft, props.organizationId, tr],
  );
  const remove = useAction<[OrganizationRankResource], void>(
    {
      handler: async (rank) => {
        const confirmed = await dialog.confirm({
          title: tr("organizations.ranks.deleteTitle", {
            default: "Delete $1?",
            args: [rank.name],
          }),
          description: tr("organizations.ranks.deleteDescription", {
            default: "A rank held by a member cannot be deleted.",
          }),
          confirmLabel: tr("organizations.ranks.delete", {
            default: "Delete",
          }),
          destructive: true,
        });
        if (!confirmed) return;
        await api.deleteOrganizationRank({
          params: { organizationId: props.organizationId, key: rank.key },
        });
        toaster.success(
          tr("organizations.ranks.deleted", { default: "Rank deleted" }),
        );
      },
      invalidates,
    },
    [api, dialog, props.organizationId, toaster, tr],
  );

  const saving =
    save.loading || create.loading || rename.loading || remove.loading;
  const label = props.label ?? ((_key, fallback) => fallback);
  const groups: PermissionMatrixGroup[] = (
    catalogueQuery.data?.groups ?? []
  ).flatMap((group) => {
    const permissions = group.permissions
      .filter(
        (permission) => props.filterPermission?.(permission, group) ?? true,
      )
      .map((permission) => ({
        name: permission.name,
        label: label(permission.label, permission.name),
        description: permission.description,
        lock: props.lockPermission?.(permission, group),
      }));
    return permissions.length
      ? [
          {
            key: group.name,
            label: label(group.label, group.name),
            permissions,
          },
        ]
      : [];
  });
  const holdersOf = (key: string) =>
    (membersQuery.data ?? []).filter(
      (member) => (member.rank ?? "member") === key,
    ).length;
  const columns: PermissionMatrixColumn[] = ranks.map((rank) => ({
    key: rank.key,
    readOnly: !rank.editable,
    description: tr("organizations.ranks.holders", {
      default: "$1 members",
      args: [String(holdersOf(rank.key))],
    }),
    label: (
      <OrganizationRankColumnHeader
        name={rank.name}
        onRename={
          rank.editable && !saving ? () => void rename.run(rank) : undefined
        }
        onDelete={
          !rank.builtin && rank.editable && !saving
            ? () => void remove.run(rank)
            : undefined
        }
      />
    ),
  }));
  const dirty =
    seededFrom !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(organizationRankDraft(ranks));

  return (
    <div className="flex flex-col gap-4" aria-busy={saving}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            {tr("organizations.ranks.title", { default: "Ranks" })}
          </span>
          <span className="text-muted-foreground text-xs">
            {tr("organizations.ranks.description", {
              default: "Choose what each rank may do.",
            })}
          </span>
          <span className="text-muted-foreground text-xs">
            {tr("organizations.ranks.cache", {
              default:
                "Permission definition changes can take up to 30 seconds. Rank demotions take effect immediately.",
            })}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outlined" size="sm" aria-label="Create rank" />
            }
          >
            <Plus className="size-3.5" />
            {tr("organizations.ranks.create", { default: "Create rank" })}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={saving}
              onClick={() => void create.run(undefined)}
            >
              {tr("organizations.ranks.blank", { default: "Blank rank" })}
            </DropdownMenuItem>
            {!!props.presets?.length && <DropdownMenuSeparator />}
            {props.presets?.map((preset) => (
              <DropdownMenuItem
                key={preset.key}
                disabled={saving}
                onClick={() => void create.run(preset)}
              >
                {tr("organizations.ranks.fromPreset", {
                  default: "Start from $1",
                  args: [preset.name],
                })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Card className={cn(settingsCardEdge, "gap-0 py-0")}>
        <PermissionMatrix
          header={tr("organizations.ranks.permission", {
            default: "Permission",
          })}
          empty={tr("organizations.ranks.empty", {
            default: "No permissions to display.",
          })}
          disabled={saving}
          groups={groups}
          columns={columns}
          value={draft}
          onChange={setDraft}
        />
      </Card>
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            variant="minimal"
            disabled={saving}
            onClick={() => setDraft(organizationRankDraft(ranks))}
          >
            {tr("organizations.ranks.cancel", { default: "Cancel" })}
          </Button>
          <Button
            disabled={saving}
            onClick={() => void save.run()}
            aria-label="Save ranks"
          >
            <Save className="size-4" />
            {tr("organizations.ranks.save", { default: "Save ranks" })}
          </Button>
        </div>
      )}
    </div>
  );
};

const organizationRankDraft = (
  ranks: OrganizationRankResource[],
): Record<string, string[]> =>
  Object.fromEntries(
    ranks
      .filter((rank) => rank.editable)
      .map((rank) => [rank.key, [...rank.permissions]]),
  );

const samePermissions = (left: string[], right: string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
