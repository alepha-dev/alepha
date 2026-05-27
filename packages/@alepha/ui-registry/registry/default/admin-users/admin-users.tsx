import { type Page, type Static, t } from "alepha";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Eye, Search, Trash2, UserCheck, UserX } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AlephaTable } from "@/registry/default/alepha-table/alepha-table";
import { Control } from "@/registry/default/control/control";
import { useDialog } from "@/registry/default/use-dialog/use-dialog";

export interface AdminUsersProps {
  /**
   * Realm name to query users from. Defaults to the configured user realm.
   */
  userRealmName?: string;
}

// Filter schema. Lives at module scope so its identity stays stable
// across renders — AlephaTable's internal `useForm` only captures it
// once and a fresh reference per render would harmlessly re-anchor the
// form initialization but is wasteful.
const filtersSchema = t.object({
  search: t.optional(t.string()),
});
type AdminUserFilters = Static<typeof filtersSchema>;

export function AdminUsers(props: AdminUsersProps) {
  const client = useClient<AdminUserController>();
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const { l, tr } = useI18n();
  const dialog = useDialog();

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AdminUserFilters;
    }) => {
      const res = await client.findUsers({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
          userRealmName: props.userRealmName,
        } as never,
      });
      return res as Page<UserEntity>;
    },
    [client, props.userRealmName],
  );

  const isSelf = (user: UserEntity) => currentUser?.id === user.id;

  const userLabel = (u: UserEntity) =>
    u.email ||
    u.username ||
    tr("admin.users.thisUser", { default: "this user" });

  const handleToggleEnabled = async (user: UserEntity, refresh: () => void) => {
    if (isSelf(user)) {
      toast.error(
        tr("admin.users.cantDisableSelf", {
          default: "You cannot disable your own account",
        }),
      );
      return;
    }
    const enable = !user.enabled;
    const label = userLabel(user);
    const ok = await dialog.confirm({
      title: enable
        ? tr("admin.users.enableTitle", { default: "Enable user" })
        : tr("admin.users.disableTitle", { default: "Disable user" }),
      description: enable
        ? tr("admin.users.enableConfirm", {
            default: `Enable ${label}?`,
            args: [label],
          })
        : tr("admin.users.disableConfirm", {
            default: `Disable ${label}? They will no longer be able to sign in.`,
            args: [label],
          }),
      destructive: !enable,
    });
    if (!ok) return;
    await client.updateUser({
      params: { id: user.id },
      query: { userRealmName: props.userRealmName },
      body: { enabled: enable },
    });
    toast.success(
      enable
        ? tr("admin.users.enabled", { default: "User enabled" })
        : tr("admin.users.disabled", { default: "User disabled" }),
    );
    refresh();
  };

  const handleDelete = async (user: UserEntity, refresh: () => void) => {
    const label = userLabel(user);
    const ok = await dialog.confirm({
      title: tr("admin.users.deleteTitle", { default: "Delete user" }),
      description: tr("admin.users.deleteConfirm", {
        default: `Permanently delete ${label}? This action cannot be undone.`,
        args: [label],
      }),
      destructive: true,
    });
    if (!ok) return;
    await client.deleteUser({
      params: { id: user.id },
      query: { userRealmName: props.userRealmName },
    });
    toast.success(tr("admin.users.deleted", { default: "User deleted" }));
    refresh();
  };

  const handleBulkDelete = async (
    items: UserEntity[],
    {
      clearSelection,
      refresh,
    }: { clearSelection: () => void; refresh: () => void },
  ) => {
    const targets = items.filter((u) => !isSelf(u));
    if (targets.length === 0) {
      toast.error(
        tr("admin.users.noneSelected", {
          default: "No deletable users in selection",
        }),
      );
      return;
    }
    const ok = await dialog.confirm({
      title: tr("admin.users.bulkDeleteTitle", { default: "Delete users" }),
      description: tr("admin.users.bulkDeleteConfirm", {
        default: `Delete ${targets.length} user(s)? This cannot be undone.`,
        args: [String(targets.length)],
      }),
      destructive: true,
    });
    if (!ok) return;
    const res = await client.deleteUsers({
      query: { userRealmName: props.userRealmName },
      body: { ids: targets.map((u) => u.id) },
    });
    toast.success(
      tr("admin.users.bulkDeleted", {
        default: `${res.deleted.length} user(s) deleted`,
        args: [String(res.deleted.length)],
      }),
    );
    clearSelection();
    refresh();
  };

  const handleBulkDisable = async (
    items: UserEntity[],
    {
      clearSelection,
      refresh,
    }: { clearSelection: () => void; refresh: () => void },
  ) => {
    const enabled = items.filter((u) => u.enabled && !isSelf(u));
    if (enabled.length === 0) {
      toast.error(
        tr("admin.users.noneSelected", {
          default: "No active users in selection",
        }),
      );
      return;
    }
    const ok = await dialog.confirm({
      title: tr("admin.users.bulkDisableTitle", { default: "Disable users" }),
      description: tr("admin.users.bulkDisableConfirm", {
        default: `Disable ${enabled.length} user(s)? They will no longer be able to sign in.`,
        args: [String(enabled.length)],
      }),
      destructive: true,
    });
    if (!ok) return;
    for (const u of enabled) {
      await client.updateUser({
        params: { id: u.id },
        query: { userRealmName: props.userRealmName },
        body: { enabled: false },
      });
    }
    toast.success(
      tr("admin.users.bulkDisabled", {
        default: `${enabled.length} user(s) disabled`,
        args: [String(enabled.length)],
      }),
    );
    clearSelection();
    refresh();
  };

  return (
    <div className="flex flex-1 flex-col gap-3 p-6">
      <AlephaTable<UserEntity>
        className="min-h-0 flex-1"
        persistenceKey="admin.users"
        fetch={fetcher}
        filters={{
          schema: filtersSchema,
          render: (form) => (
            <div className="w-72">
              <Control
                input={form.input.search}
                label=""
                icon={Search}
                placeholder={String(
                  tr("admin.users.searchPlaceholder", {
                    default: "Search…",
                  }),
                )}
                inputProps={{
                  "aria-label": String(
                    tr("admin.users.search", { default: "Search users" }),
                  ),
                }}
              />
            </div>
          ),
        }}
        bulkActions={[
          {
            label: tr("admin.users.bulkDisable", {
              default: "Disable selected",
            }),
            icon: UserX,
            destructive: true,
            onClick: handleBulkDisable,
          },
          {
            label: tr("admin.users.bulkDelete", {
              default: "Delete selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: handleBulkDelete,
          },
        ]}
        columns={{
          user: {
            label: tr("admin.users.colUser", { default: "User" }),
            cell: (u) => {
              const name =
                `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
                u.username ||
                tr("admin.users.anonymous", { default: "Anonymous" });
              return (
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>
                      {name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground text-xs">
                      {u.email || "—"}
                    </span>
                  </div>
                </div>
              );
            },
          },
          roles: {
            label: tr("admin.users.colRoles", { default: "Roles" }),
            cell: (u) =>
              u.roles.length > 0 ? (
                <div className="flex gap-1">
                  {u.roles.map((r: string) => (
                    <Badge key={r} variant="secondary">
                      {r}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("admin.users.noRoles", { default: "No roles" })}
                </span>
              ),
          },
          enabled: {
            label: tr("admin.users.colStatus", { default: "Status" }),
            cell: (u) => (
              <Badge variant={u.enabled ? "default" : "destructive"}>
                {u.enabled
                  ? tr("admin.users.active", { default: "Active" })
                  : tr("admin.users.statusDisabled", { default: "Disabled" })}
              </Badge>
            ),
          },
          emailVerified: {
            label: tr("admin.users.colEmail", { default: "Email" }),
            cell: (u) => (
              <Badge variant={u.emailVerified ? "default" : "outline"}>
                {u.emailVerified
                  ? tr("admin.users.verified", { default: "Verified" })
                  : tr("admin.users.unverified", { default: "Unverified" })}
              </Badge>
            ),
          },
          createdAt: {
            label: tr("admin.users.colJoined", { default: "Joined" }),
            sortable: true,
            // Defaulting joined-date hidden keeps the table compact on
            // first view; opt back in via the column picker. The
            // sortable header still works once enabled.
            defaultHidden: false,
            cell: (u) => (
              <span className="text-muted-foreground text-xs">
                {String(l(u.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(u) => [
          {
            label: tr("admin.users.viewProfile", { default: "View profile" }),
            icon: Eye,
            onClick: () => router.push(`/admin/users/${u.id}` as never),
          },
          ...(!isSelf(u)
            ? [
                {
                  label: u.enabled
                    ? tr("admin.users.disableUser", {
                        default: "Disable user",
                      })
                    : tr("admin.users.enableUser", { default: "Enable user" }),
                  icon: u.enabled ? UserX : UserCheck,
                  onClick: (
                    _u: UserEntity,
                    { refresh }: { refresh: () => void },
                  ) => handleToggleEnabled(u, refresh),
                },
                {
                  label: tr("admin.users.deleteUser", {
                    default: "Delete user",
                  }),
                  icon: Trash2,
                  destructive: true,
                  onClick: (
                    _u: UserEntity,
                    { refresh }: { refresh: () => void },
                  ) => handleDelete(u, refresh),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
