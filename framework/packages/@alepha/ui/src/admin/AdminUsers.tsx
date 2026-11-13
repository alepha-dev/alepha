import * as React from "react";

import TimeAgo from "../core/TimeAgo.tsx";

void React;

import { z } from "alepha";
import type {
  AdminAvatarController,
  AdminUserController,
  RealmController,
  UserEntity,
} from "alepha/api/users";
import { useAction, useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Check,
  CircleDot,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import { useCallback, useState } from "react";

import { useDialog } from "../core/useDialog.tsx";
import { UserAvatar } from "../core/UserAvatar.tsx";
import { useToast } from "../core/useToast.tsx";
import { DataTable } from "../table/DataTable.tsx";
import type {
  DataTableFilterFields,
  DataTableFilterValues,
} from "../table/dataTableTypes.ts";
import { AdminPage } from "./AdminPage.tsx";
import { AdminUsersCreateDialog } from "./AdminUsersCreateDialog.tsx";
import { AdminUsersRolesPicker } from "./AdminUsersRolesPicker.tsx";
import { AdminUsersStatusBadge } from "./AdminUsersStatusBadge.tsx";

export interface AdminUsersProps {
  /**
   * Realm name to query users from. Defaults to the configured user realm.
   */
  userRealmName?: string;
  /**
   * Column keys to hide by default. Users can still toggle them on via
   * the column picker. Useful when the host app doesn't populate certain
   * fields (e.g. apps without `firstName`/`lastName`).
   */
  defaultHiddenColumns?: ReadonlyArray<
    | "username"
    | "firstName"
    | "lastName"
    | "email"
    | "roles"
    | "enabled"
    | "createdAt"
    | "lastLoginAt"
  >;
}

type StatusPreset = {
  enabled?: boolean;
  emailVerified?: boolean;
};

const STATUS_PRESETS: Record<string, StatusPreset> = {
  verified: { enabled: true, emailVerified: true },
  active: { enabled: true },
  disabled: { enabled: false },
};

function applyDefaultHidden<C extends Record<string, unknown>>(
  hiddenKeys: readonly string[] | undefined,
  columns: C,
): C {
  if (!hiddenKeys?.length) return columns;
  const next = { ...columns } as Record<string, any>;
  for (const key of hiddenKeys) {
    if (next[key]) next[key] = { ...next[key], defaultHidden: true };
  }
  return next as C;
}

export const AdminUsers = (props: AdminUsersProps) => {
  const client = useClient<AdminUserController>();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const router = useRouter<any>();
  const { tr } = useI18n();
  const dialog = useDialog();
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  // Resolved against /api/_links: absent without `admin:user:create`.
  const canCreate = client.createUser.can();

  // Role metadata is a read-only fetch via useQuery: runs on mount, re-runs
  // when realm changes, aborts on unmount via the passed signal.
  // The picker simply degrades to read-only text if the metadata fetch fails;
  // not a blocking error (swallowed in onError).
  const rolesQuery = useQuery(
    {
      handler: ({ signal }) =>
        client.findRoles(
          { query: { userRealmName: props.userRealmName } },
          { request: { signal } },
        ),
      onError: () => {},
    },
    [client, props.userRealmName],
  );
  const availableRoles = rolesQuery.data ?? [];

  /*
   * Which identity columns the app uses (#Q3571). A realm whose email
   * requirement is `none` collects no email, so the column would be a row of
   * dashes: it goes. Unknown (the config could not be read) keeps it.
   *
   * Pictures have no realm setting of their own: the signal is the realm's
   * `avatars` feature, which registers `AdminAvatarController`, so its action
   * is in `/api/_links` exactly when the app uses pictures - the same gate
   * the detail page's avatar control reads. Without it every row shows the
   * user's initials (#Q3577), and no picture is fetched.
   */
  const realmClient = useClient<RealmController>();
  const realmQuery = useQuery(
    {
      handler: ({ signal }) =>
        realmClient.getRealmConfig(
          { query: { realmName: props.userRealmName } },
          { request: { signal } },
        ),
      onError: () => {},
    },
    [realmClient, props.userRealmName],
  );
  const usesEmail = realmQuery.data?.settings?.email !== "none";
  const usesPictures =
    useClient<AdminAvatarController>().updateUserAvatar.can();
  // ⚠️ A fixed path, as the row push always was: the UI showcase mounts
  // this table outside `AdminRouter`, where no `userDetail` route exists.
  const detailHref = (u: UserEntity) => `/admin/users/${u.id}`;

  const filterFields = {
    search: { preset: "search" },
    // Nothing = every user, "verified" = active with a verified email,
    // "active" = enabled, "disabled" = not enabled. A free-form string rather
    // than an enum, so an unknown value from an older stored filter maps to
    // no preset (every user) instead of failing to decode.
    status: {
      schema: z.string(),
      label: tr("admin.users.colStatus", { default: "Status" }),
      icon: CircleDot,
      items: [
        {
          value: "verified",
          label: tr("admin.users.statusVerified", { default: "Verified" }),
        },
        {
          value: "active",
          label: tr("admin.users.statusActive", { default: "Active" }),
        },
        {
          value: "disabled",
          label: tr("admin.users.statusDisabled", { default: "Disabled" }),
        },
      ],
      control: {
        clearLabel: tr("admin.users.statusAll", { default: "All status" }),
      },
    },
  } satisfies DataTableFilterFields;

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: DataTableFilterValues<typeof filterFields>;
    }) => {
      const preset = params.filters?.status
        ? STATUS_PRESETS[params.filters.status]
        : undefined;
      return client.findUsers({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
          enabled: preset?.enabled,
          emailVerified: preset?.emailVerified,
          userRealmName: props.userRealmName,
        },
      });
    },
    [client, props.userRealmName],
  );

  const isSelf = (user: UserEntity) => currentUser?.id === user.id;

  const setRoles = useAction<[UserEntity, string[]]>(
    {
      handler: async (_ctx, user, roles) => {
        await client.updateUser({
          params: { id: user.id },
          query: { userRealmName: props.userRealmName },
          body: { roles },
        });
        // Said out loud (#Q3433): a role change saved in silence. A failure
        // throws, so `AppShell`'s ActionErrorToaster toasts it, and the
        // picker keeps the roles it had: it only applies a change that saved.
        toast.success(
          tr("admin.users.rolesSaved", {
            default: `Roles of ${userLabel(user)} saved`,
            args: [userLabel(user)],
          }),
        );
      },
    },
    [client, props.userRealmName, toast, tr],
  );

  const userLabel = (u: UserEntity) =>
    u.email ||
    u.username ||
    tr("admin.users.thisUser", { default: "this user" });

  const toggleEnabled = useAction<[UserEntity]>(
    {
      handler: async (_ctx, user) => {
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
      },
    },
    [client, currentUser, props.userRealmName],
  );

  const deleteUser = useAction<[UserEntity]>(
    {
      handler: async (_ctx, user) => {
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
      },
    },
    [client, props.userRealmName],
  );

  const bulkDelete = useAction<[UserEntity[]]>(
    {
      handler: async (_ctx, items) => {
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
            count: targets.length,
            default: {
              one: "Delete {count} user? This cannot be undone.",
              other: "Delete {count} users? This cannot be undone.",
            },
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
            count: res.deleted.length,
            default: {
              one: "{count} user deleted",
              other: "{count} users deleted",
            },
          }),
        );
      },
    },
    [client, currentUser, props.userRealmName],
  );

  const bulkDisable = useAction<[UserEntity[]]>(
    {
      handler: async (_ctx, items) => {
        const enabled = items.filter((u) => u.enabled && !isSelf(u));
        if (enabled.length === 0) {
          toast.error(
            tr("admin.users.noneActive", {
              default: "No active users in selection",
            }),
          );
          return;
        }
        const ok = await dialog.confirm({
          title: tr("admin.users.bulkDisableTitle", {
            default: "Disable users",
          }),
          description: tr("admin.users.bulkDisableConfirm", {
            count: enabled.length,
            default: {
              one: "Disable {count} user? They will no longer be able to sign in.",
              other:
                "Disable {count} users? They will no longer be able to sign in.",
            },
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
            count: enabled.length,
            default: {
              one: "{count} user disabled",
              other: "{count} users disabled",
            },
          }),
        );
      },
    },
    [client, currentUser, props.userRealmName],
  );

  return (
    <AdminPage>
      <DataTable<UserEntity, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="admin.users"
        fetch={fetcher}
        refreshSignal={refreshSignal}
        actions={
          canCreate
            ? [
                {
                  icon: UserPlus,
                  label: tr("admin.users.create", { default: "Create user" }),
                  primary: true,
                  onClick: () => setCreateOpen(true),
                },
              ]
            : undefined
        }
        filters={{ fields: filterFields }}
        bulkActions={[
          {
            label: tr("admin.users.bulkDisable", {
              default: "Disable selected",
            }),
            icon: UserX,
            destructive: true,
            onClick: async (items, ctx) => {
              if (!(await bulkDisable.run(items)).ok) return;
              ctx.clearSelection();
              ctx.refresh();
            },
          },
          {
            label: tr("admin.users.bulkDelete", {
              default: "Delete selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: async (items, ctx) => {
              if (!(await bulkDelete.run(items)).ok) return;
              ctx.clearSelection();
              ctx.refresh();
            },
          },
        ]}
        // The whole row opens the user (#Q3571); the email and username
        // are real anchors too, for a new tab.
        onRowClick={(u) => void router.push(detailHref(u))}
        columns={applyDefaultHidden(props.defaultHiddenColumns, {
          // Every user has an avatar (#Q3577): the picture when the app
          // uses pictures and the user set one, else their initials.
          avatar: {
            label: tr("admin.users.colPicture", { default: "Picture" }),
            cell: (u: UserEntity) => (
              <UserAvatar user={u} fileId={usesPictures ? u.picture : null} />
            ),
          },
          ...(usesEmail
            ? {
                email: {
                  label: tr("admin.users.colEmail", { default: "Email" }),
                  cell: (u: UserEntity) => (
                    <Link
                      href={detailHref(u)}
                      onClick={(event) => event.stopPropagation()}
                      className="hover:text-primary inline-flex max-w-full items-center gap-1.5 truncate font-medium underline-offset-2 hover:underline"
                    >
                      <span className="truncate">{u.email ?? "—"}</span>
                      {u.emailVerified && u.email && (
                        <Check
                          className="size-3.5 shrink-0 text-emerald-500"
                          aria-label={tr("admin.users.verified", {
                            default: "Verified",
                          })}
                        />
                      )}
                    </Link>
                  ),
                },
              }
            : {}),
          username: {
            label: tr("admin.users.colUsername", { default: "Username" }),
            cell: (u) =>
              u.username ? (
                <Link
                  href={detailHref(u)}
                  onClick={(event) => event.stopPropagation()}
                  className="hover:text-primary truncate underline-offset-2 hover:underline"
                >
                  @{u.username}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          firstName: {
            label: tr("admin.users.colFirstName", { default: "First name" }),
            cell: (u) =>
              u.firstName ? (
                <span className="truncate">{u.firstName}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          lastName: {
            label: tr("admin.users.colLastName", { default: "Last name" }),
            cell: (u) =>
              u.lastName ? (
                <span className="truncate">{u.lastName}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          roles: {
            label: tr("admin.users.colRoles", { default: "Roles" }),
            cell: (u) => (
              // The picker is a control inside a clickable row: its click is
              // its own, not the row's.
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
              <div onClick={(event) => event.stopPropagation()}>
                <AdminUsersRolesPicker
                  user={u}
                  availableRoles={availableRoles}
                  onToggle={async (roles) => (await setRoles.run(u, roles)).ok}
                  rolesLabel={tr("admin.users.rolesLabel", {
                    default: "Roles",
                  })}
                  noRolesLabel={tr("admin.users.noRoles", {
                    default: "No roles",
                  })}
                />
              </div>
            ),
          },
          enabled: {
            label: tr("admin.users.colStatus", { default: "Status" }),
            cell: (u) => <AdminUsersStatusBadge enabled={u.enabled} />,
          },
          createdAt: {
            label: tr("admin.users.colJoined", { default: "Joined" }),
            sortable: true,
            // Defaulting joined-date hidden keeps the table compact on
            // first view; opt back in via the column picker. The
            // sortable header still works once enabled.
            defaultHidden: true,
            cell: (u) => (
              <TimeAgo
                value={u.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
          lastLoginAt: {
            label: tr("admin.users.colLastLogin", { default: "Last login" }),
            sortable: true,
            cell: (u) =>
              u.lastLoginAt ? (
                <TimeAgo
                  value={u.lastLoginAt}
                  className="text-muted-foreground text-xs"
                />
              ) : (
                <span className="text-muted-foreground text-xs">-</span>
              ),
          },
        })}
        rowActions={(u) =>
          !isSelf(u)
            ? [
                {
                  label: u.enabled
                    ? tr("admin.users.disableUser", {
                        default: "Disable user",
                      })
                    : tr("admin.users.enableUser", { default: "Enable user" }),
                  icon: u.enabled ? UserX : UserCheck,
                  onClick: async (
                    _u: UserEntity,
                    { refresh }: { refresh: () => void },
                  ) => {
                    if ((await toggleEnabled.run(u)).ok) refresh();
                  },
                },
                {
                  label: tr("admin.users.deleteUser", {
                    default: "Delete user",
                  }),
                  icon: Trash2,
                  destructive: true,
                  onClick: async (
                    _u: UserEntity,
                    { refresh }: { refresh: () => void },
                  ) => {
                    if ((await deleteUser.run(u)).ok) refresh();
                  },
                },
              ]
            : []
        }
      />
      {canCreate && (
        <AdminUsersCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          userRealmName={props.userRealmName}
          onCreated={() => {
            toast.success(
              tr("admin.users.created", { default: "User created" }),
            );
            setRefreshSignal((n) => n + 1);
          }}
        />
      )}
    </AdminPage>
  );
};

export default AdminUsers;
