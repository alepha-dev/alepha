import * as React from "react";

void React;

import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { BrandIcon } from "@alepha/ui/components/brand-icon/brand-icon";
import { Control } from "@alepha/ui/components/control/control";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alepha/ui/components/ui/avatar";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { Skeleton } from "@alepha/ui/components/ui/skeleton";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Static, z } from "alepha";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import type {
  AdminIdentityController,
  AdminSessionController,
  AdminUserController,
  IdentityResource,
  SessionResource,
  UpdateUser,
} from "alepha/api/users";
import { useAction, useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useQueryParams, useRouter, useRouterState } from "alepha/react/router";
import { HttpError } from "alepha/server";
import {
  ArrowLeft,
  Ban,
  Check,
  Copy,
  History,
  KeyRound,
  LogOut,
  Monitor,
  ShieldCheck,
  Trash2,
  User,
  UserCheck,
  UserX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface AdminUserDetailProps {
  /**
   * Realm name to scope all admin queries. Defaults to the configured
   * user realm.
   */
  userRealmName?: string;
  /**
   * Path to the users list page, for the "Back" link. Defaults to
   * `/admin/users`.
   */
  backPath?: string;
}

const profileSchema = z.object({
  username: z.string().optional(),
  email: z.string().optional(),
  emailVerified: z.boolean().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  roles: z.array(z.string()).optional(),
});
type ProfileForm = Static<typeof profileSchema>;

const passwordSchema = z.object({
  password: z.string().min(6),
});

type TabKey = "overview" | "security" | "sessions" | "audits";
const tabSchema = z.object({ tab: z.string().optional() });

const PROVIDER_LABELS: Record<string, string> = {
  credentials: "Password",
  google: "Google",
  apple: "Apple",
  github: "GitHub",
  microsoft: "Microsoft",
  facebook: "Facebook",
};

export function AdminUserDetail(props: AdminUserDetailProps) {
  const router = useRouter();
  const routerState = useRouterState();
  const userId = String(routerState.params.id ?? "");
  const userClient = useClient<AdminUserController>();
  const sessionClient = useClient<AdminSessionController>();
  const identityClient = useClient<AdminIdentityController>();
  const auditClient = useClient<AdminAuditController>();
  const { tr, l } = useI18n();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const dialog = useDialog();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Clear the copy-feedback reset timer on unmount.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  // Tab selection is bound to the URL (`?tab=<key>`) via useQueryParams in
  // querystring mode, which uses replaceState — switching tabs does not add
  // a browser-history entry.
  const [tabQuery, setTabQuery] = useQueryParams(tabSchema, {
    format: "querystring",
  });
  const tab = (tabQuery.tab as TabKey) ?? "overview";
  const setTab = (next: TabKey) => setTabQuery({ tab: next });

  const isSelf = currentUser?.id === userId;
  const backPath = props.backPath ?? "/admin/users";

  // -- Load user, roles, identities -----------------------------------------
  // All three are read-only fetches via useQuery: each runs on mount, re-runs
  // when realm/id change, aborts on unmount via the passed signal, and exposes
  // refetch() — so the mutations below just call the relevant refetch()
  // instead of bumping a manual reload key.

  const userQuery = useQuery(
    {
      handler: ({ signal }) =>
        userClient.getUser(
          {
            params: { id: userId },
            query: { userRealmName: props.userRealmName },
          },
          { request: { signal } },
        ),
      onError: (err) => {
        toast.error(
          tr("admin.userDetail.loadError", { default: "Failed to load user" }),
        );
        console.error(err);
      },
    },
    [userClient, userId, props.userRealmName],
  );
  const user = userQuery.data;

  const rolesQuery = useQuery(
    {
      handler: ({ signal }) =>
        userClient.findRoles(
          { query: { userRealmName: props.userRealmName } },
          { request: { signal } },
        ),
      // Role metadata is non-blocking — swallow errors so the page still loads.
      onError: () => {},
    },
    [userClient, props.userRealmName],
  );
  const availableRoles = rolesQuery.data ?? [];

  const identitiesQuery = useQuery(
    {
      handler: ({ signal }) =>
        identityClient.findIdentities(
          { query: { userId, size: 100, userRealmName: props.userRealmName } },
          { request: { signal } },
        ),
      // Identities may fail if the controller isn't mounted — non-blocking.
      onError: () => {},
    },
    [identityClient, userId, props.userRealmName],
  );
  const identities = identitiesQuery.data?.content ?? [];

  // -- Profile form ---------------------------------------------------------

  const form = useForm({
    schema: profileSchema,
    initialValues: {
      username: user?.username ?? "",
      email: user?.email ?? "",
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      emailVerified: user?.emailVerified ?? false,
      roles: user?.roles ?? [],
    },
    handler: async (values: ProfileForm) => {
      // Required-field guards (kept in handler, not in schema, so
      // useForm's initial-decode doesn't crash on the empty mount).
      const username = (values.username ?? "").trim();
      const email = (values.email ?? "").trim();
      if (!username) {
        throw new FormValidationError({
          message: tr("admin.userDetail.usernameRequired", {
            default: "Username is required",
          }),
          path: "/username",
        });
      }
      if (!email) {
        throw new FormValidationError({
          message: tr("admin.userDetail.emailRequired", {
            default: "Email is required",
          }),
          path: "/email",
        });
      }

      // Changing the email invalidates the verified flag — server-side
      // enforcement is also recommended, but mirror it client-side so
      // the UI is immediately consistent.
      const emailChanged = user && email !== (user.email ?? "");
      const body: UpdateUser = {
        username,
        email,
        firstName: (values.firstName ?? "").trim(),
        lastName: (values.lastName ?? "").trim(),
        roles: values.roles ?? [],
        emailVerified: emailChanged ? false : Boolean(values.emailVerified),
      };

      try {
        await userClient.updateUser({
          params: { id: userId },
          query: { userRealmName: props.userRealmName },
          body,
        });
        toast.success(
          tr("admin.userDetail.saved", { default: "Profile saved" }),
        );
        await userQuery.refetch();
      } catch (err) {
        const message =
          err instanceof HttpError
            ? err.message
            : tr("admin.userDetail.saveError", {
                default: "Failed to save profile",
              });
        toast.error(message);
        throw err;
      }
    },
  });

  // Reset the form's initial values whenever the loaded user changes.
  // setInitialValues (vs per-field .set) is required so the AutoForm
  // "Reset" button snaps the form back to the server snapshot rather
  // than the empty values captured at mount.
  useEffect(() => {
    if (!user) return;
    form.setInitialValues({
      username: user.username ?? "",
      email: user.email ?? "",
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      emailVerified: user.emailVerified ?? false,
      roles: user.roles ?? [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userQuery.data]);

  // -- Set password ---------------------------------------------------------

  const passwordForm = useForm({
    schema: passwordSchema,
    handler: async ({ password }) => {
      await userClient.setUserPassword({
        params: { id: userId },
        query: { userRealmName: props.userRealmName },
        body: { password },
      });
      toast.success(
        tr("admin.userDetail.passwordSet", {
          default: "Password updated",
        }),
      );
      passwordForm.input.password.set?.("");
      setPasswordOpen(false);
    },
  });
  const { loading: passwordSubmitting } = useFormState(passwordForm, [
    "loading",
  ]);

  // -- Enable/disable -------------------------------------------------------

  const toggleEnabled = useAction(
    {
      handler: async () => {
        if (!user || isSelf) return;
        const enable = !user.enabled;
        const label =
          user.email ||
          user.username ||
          tr("admin.userDetail.thisUser", {
            default: "this user",
          });
        const ok = await dialog.confirm({
          title: enable
            ? tr("admin.userDetail.enableTitle", { default: "Enable user" })
            : tr("admin.userDetail.disableTitle", { default: "Disable user" }),
          description: enable
            ? tr("admin.userDetail.enableConfirm", {
                default: `Enable ${label}?`,
                args: [String(label)],
              })
            : tr("admin.userDetail.disableConfirm", {
                default: `Disable ${label}? They will no longer be able to sign in.`,
                args: [String(label)],
              }),
          destructive: !enable,
        });
        if (!ok) return;
        await userClient.updateUser({
          params: { id: userId },
          query: { userRealmName: props.userRealmName },
          body: { enabled: enable },
        });
        await userQuery.refetch();
        toast.success(
          enable
            ? tr("admin.userDetail.enabled", { default: "User enabled" })
            : tr("admin.userDetail.disabled", { default: "User disabled" }),
        );
      },
    },
    [user, isSelf],
  );

  // -- Delete ---------------------------------------------------------------

  const deleteUser = useAction(
    {
      handler: async () => {
        if (!user || isSelf) return;
        const label =
          user.email ||
          user.username ||
          tr("admin.userDetail.thisUser", {
            default: "this user",
          });
        const ok = await dialog.confirm({
          title: tr("admin.userDetail.deleteTitle", { default: "Delete user" }),
          description: tr("admin.userDetail.deleteConfirm", {
            default: `Permanently delete ${label}? This action cannot be undone.`,
            args: [String(label)],
          }),
          destructive: true,
          confirmLabel: String(
            tr("admin.userDetail.deleteCta", { default: "Delete" }),
          ),
        });
        if (!ok) return;
        await userClient.deleteUser({
          params: { id: userId },
          query: { userRealmName: props.userRealmName },
        });
        toast.success(
          tr("admin.userDetail.deleted", { default: "User deleted" }),
        );
        await router.push(backPath);
      },
    },
    [user, isSelf],
  );

  // -- Remove social auth ---------------------------------------------------

  const removeIdentity = useAction<[IdentityResource]>(
    {
      handler: async (identity) => {
        const provider =
          PROVIDER_LABELS[identity.provider] ?? identity.provider;
        const ok = await dialog.confirm({
          title: tr("admin.userDetail.removeIdentityTitle", {
            default: "Remove connection",
          }),
          description: tr("admin.userDetail.removeIdentityConfirm", {
            default: `Remove the ${provider} connection? The user will no longer be able to sign in with it.`,
            args: [provider],
          }),
          destructive: true,
        });
        if (!ok) return;
        await identityClient.deleteIdentity({
          params: { id: identity.id },
          query: { userRealmName: props.userRealmName },
        });
        toast.success(
          tr("admin.userDetail.identityRemoved", {
            default: "Connection removed",
          }),
        );
        await identitiesQuery.refetch();
      },
    },
    [props.userRealmName],
  );

  // -- Sessions / audits fetchers -------------------------------------------

  const sessionsFetcher = useCallback(
    (params: { page: number; size: number; sort?: string }) =>
      sessionClient.findSessions({
        query: { ...params, userId, userRealmName: props.userRealmName },
      }),
    [sessionClient, userId, props.userRealmName],
  );

  const auditsFetcher = useCallback(
    (params: { page: number; size: number; sort?: string }) =>
      auditClient.findByUser({ params: { userId }, query: params }),
    [auditClient, userId],
  );

  const revokeSession = useAction<[SessionResource, () => void]>(
    {
      handler: async (s, refresh) => {
        const ok = await dialog.confirm({
          title: tr("admin.userDetail.revokeTitle", {
            default: "Revoke session",
          }),
          description: tr("admin.userDetail.revokeConfirm", {
            default:
              "Revoke this session? The user will be signed out on the matching device.",
          }),
          destructive: true,
        });
        if (!ok) return;
        await sessionClient.deleteSession({
          params: { id: s.id },
          query: { userRealmName: props.userRealmName },
        });
        refresh();
      },
    },
    [props.userRealmName],
  );

  const bulkRevokeSessions = useAction<
    [SessionResource[], { refresh: () => void; clearSelection: () => void }]
  >(
    {
      handler: async (items, ctx) => {
        const ok = await dialog.confirm({
          title: tr("admin.userDetail.bulkRevokeTitle", {
            default: "Revoke sessions",
          }),
          description: tr("admin.userDetail.bulkRevokeConfirm", {
            default: `Revoke ${items.length} sessions?`,
            args: [String(items.length)],
          }),
          destructive: true,
        });
        if (!ok) return;
        await sessionClient.deleteSessions({
          query: { userRealmName: props.userRealmName },
          body: { ids: items.map((s) => s.id) },
        });
        ctx.clearSelection();
        ctx.refresh();
      },
    },
    [props.userRealmName],
  );

  // -- Render ---------------------------------------------------------------

  if (userQuery.loading && !user) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-muted-foreground text-sm">
          {tr("admin.userDetail.notFound", { default: "User not found." })}
        </p>
        <Button variant="outline" onClick={() => router.push(backPath)}>
          <ArrowLeft className="size-4" />
          {tr("admin.userDetail.back", { default: "Back to users" })}
        </Button>
      </div>
    );
  }

  const initial = (user.email || user.username || user.firstName || "?")
    .charAt(0)
    .toUpperCase();
  const displayName =
    user.email ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    user.id.slice(0, 8);

  // A `credentials` identity means a password is set. Password sign-in lives
  // in its own card; the social providers are everything else.
  const hasPassword = identities.some((id) => id.provider === "credentials");
  const socialIdentities = identities.filter(
    (id) => id.provider !== "credentials",
  );

  const tabOptions = [
    {
      value: "overview",
      label: (
        <span className="inline-flex items-center gap-1.5">
          <User className="size-4" />
          {tr("admin.userDetail.tabOverview", { default: "Overview" })}
        </span>
      ),
    },
    {
      value: "security",
      label: (
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-4" />
          {tr("admin.userDetail.tabSecurity", { default: "Security" })}
        </span>
      ),
    },
    {
      value: "sessions",
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Monitor className="size-4" />
          {tr("admin.userDetail.tabSessions", { default: "Sessions" })}
        </span>
      ),
    },
    {
      value: "audits",
      label: (
        <span className="inline-flex items-center gap-1.5">
          <History className="size-4" />
          {tr("admin.userDetail.tabAudits", { default: "Audit log" })}
        </span>
      ),
    },
  ];

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      setCopiedId(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(false), 1_500);
    } catch {
      // clipboard may be unavailable (insecure context); ignore
    }
  };

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  // Admin-style identity sheet: a dense label/value list rather than a
  // marketing hero. Only fields with a value are listed; ID and Status
  // always show.
  // Admin identity sheet, in display order:
  // ID → username → email → (phone) → status → name → roles → dates.
  const rows: Array<{ label: string; value: React.ReactNode }> = [];

  rows.push({
    label: tr("admin.userDetail.id", { default: "ID" }),
    value: (
      <div className="flex items-center gap-1">
        <code
          className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs"
          title={user.id}
        >
          {user.id}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={copyId}
          aria-label={String(
            tr("admin.userDetail.copyId", { default: "Copy ID" }),
          )}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {copiedId ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>
    ),
  });
  if (user.username) {
    rows.push({
      label: tr("admin.userDetail.username", { default: "Username" }),
      value: (
        <span className="block truncate" title={user.username}>
          @{user.username}
        </span>
      ),
    });
  }
  if (user.email) {
    rows.push({
      label: tr("admin.userDetail.email", { default: "Email" }),
      value: (
        <a
          href={`mailto:${user.email}`}
          className="text-primary block truncate hover:underline"
          title={user.email}
        >
          {user.email}
        </a>
      ),
    });
  }
  if (user.phoneNumber) {
    rows.push({
      label: tr("admin.userDetail.phone", { default: "Phone" }),
      value: (
        <a
          href={`tel:${user.phoneNumber}`}
          className="text-primary block truncate font-mono hover:underline"
        >
          {user.phoneNumber}
        </a>
      ),
    });
  }
  rows.push({
    label: tr("admin.userDetail.fieldStatus", { default: "Status" }),
    value: (
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={user.enabled ? "default" : "destructive"}>
          {user.enabled
            ? tr("admin.userDetail.active", { default: "Active" })
            : tr("admin.userDetail.disabledBadge", { default: "Disabled" })}
        </Badge>
        {user.emailVerified && (
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="size-3" />
            {tr("admin.userDetail.verified", { default: "Verified" })}
          </Badge>
        )}
      </div>
    ),
  });
  rows.push({
    label: tr("admin.userDetail.name", { default: "Name" }),
    value: (
      <span className="block truncate">
        {fullName || <span className="text-muted-foreground">—</span>}
      </span>
    ),
  });
  if (user.roles?.length) {
    rows.push({
      label: tr("admin.userDetail.roles", { default: "Roles" }),
      value: <span className="block">{user.roles.join(", ")}</span>,
    });
  }
  rows.push({
    label: tr("admin.userDetail.lastLogin", { default: "Last login" }),
    value: (
      <span className="block">
        {user.lastLoginAt
          ? String(l(user.lastLoginAt, { date: "lll" }))
          : tr("admin.userDetail.never", { default: "Never" })}
      </span>
    ),
  });
  rows.push({
    label: tr("admin.userDetail.created", { default: "Created" }),
    value: (
      <span className="block">
        {String(l(user.createdAt, { date: "lll" }))}
      </span>
    ),
  });

  const identityHero = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-10 rounded-md after:rounded-md">
          {user.picture && (
            <AvatarImage
              src={user.picture}
              alt={String(displayName)}
              className="rounded-md"
            />
          )}
          <AvatarFallback className="rounded-md">{initial}</AvatarFallback>
        </Avatar>
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight"
          title={String(displayName)}
        >
          {displayName}
        </span>
      </div>
      <dl className="flex flex-col gap-3 border-t pt-4 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              {row.label}
            </dt>
            <dd className="min-w-0">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Aside (full height) ------------------------------------------- */}
      <aside className="border-border bg-background hidden w-72 shrink-0 flex-col gap-4 overflow-auto border-r p-6 md:flex">
        {identityHero}
      </aside>

      {/* Right column: top bar + tab content --------------------------- */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="bg-background flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <Segmented
            size="sm"
            options={tabOptions}
            value={tab}
            onChange={(v) => setTab(v as typeof tab)}
          />
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={toggleEnabled.loading}
              disabled={isSelf}
              onClick={() => toggleEnabled.run()}
            >
              {user.enabled ? (
                <>
                  <UserX className="size-4" />
                  {tr("admin.userDetail.disable", { default: "Disable" })}
                </>
              ) : (
                <>
                  <UserCheck className="size-4" />
                  {tr("admin.userDetail.enable", { default: "Enable" })}
                </>
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={deleteUser.loading}
              disabled={isSelf}
              onClick={() => deleteUser.run()}
            >
              <Trash2 className="size-4" />
              {tr("admin.userDetail.delete", { default: "Delete user" })}
            </Button>
          </div>
        </div>
        {tab === "overview" && (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex max-w-6xl flex-col gap-6 p-6">
              {/* Profile -------------------------------------------------- */}
              <AutoForm
                form={form}
                card
                icon="user"
                title={tr("admin.userDetail.profile", { default: "Profile" })}
                description={tr("admin.userDetail.profileSub", {
                  default: "Identity and contact info.",
                })}
                submitLabel={tr("admin.userDetail.save", {
                  default: "Save changes",
                })}
                disabledIfPristine
                fields={{
                  username: {
                    label: String(
                      tr("admin.userDetail.username", { default: "Username" }),
                    ),
                  },
                  email: {
                    label: String(
                      tr("admin.userDetail.email", { default: "Email" }),
                    ),
                  },
                  emailVerified: {
                    label: String(
                      tr("admin.userDetail.emailVerified", {
                        default: "Email verified",
                      }),
                    ),
                  },
                  firstName: {
                    label: String(
                      tr("admin.userDetail.firstName", {
                        default: "First name",
                      }),
                    ),
                  },
                  lastName: {
                    label: String(
                      tr("admin.userDetail.lastName", {
                        default: "Last name",
                      }),
                    ),
                  },
                  roles: {
                    label: String(
                      tr("admin.userDetail.roles", { default: "Roles" }),
                    ),
                    icon: ShieldCheck,
                    items: availableRoles.map((r) => ({
                      value: r.name,
                      label: r.name,
                      disabled: r.default,
                    })),
                  },
                }}
              />
            </div>
          </div>
        )}

        {tab === "security" && (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex max-w-6xl flex-col gap-6 p-6">
              {/* Credentials --------------------------------------------------- */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {tr("admin.userDetail.credentials", {
                      default: "Credentials",
                    })}
                  </CardTitle>
                  <CardDescription>
                    {tr("admin.userDetail.credentialsSub", {
                      default: "Password sign-in for this account.",
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">
                    {hasPassword
                      ? tr("admin.userDetail.credentialsHasPassword", {
                          default:
                            "A password is set. You can't remove it, but you can set a new one.",
                        })
                      : tr("admin.userDetail.credentialsNoPassword", {
                          default:
                            "No password is set yet. Set one so the user can sign in with a password.",
                        })}
                  </p>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    onClick={() => setPasswordOpen(true)}
                  >
                    <KeyRound className="size-4" />
                    {hasPassword
                      ? tr("admin.userDetail.changePassword", {
                          default: "Change password",
                        })
                      : tr("admin.userDetail.setPassword", {
                          default: "Set password",
                        })}
                  </Button>
                </CardFooter>
              </Card>

              {/* Connected accounts -------------------------------------------- */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {tr("admin.userDetail.identities", {
                      default: "Connected accounts",
                    })}
                  </CardTitle>
                  <CardDescription>
                    {tr("admin.userDetail.identitiesSub", {
                      default: "Linked OAuth providers.",
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {socialIdentities.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {tr("admin.userDetail.noIdentities", {
                        default: "No connected accounts.",
                      })}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {socialIdentities.map((id) => {
                        const label =
                          PROVIDER_LABELS[id.provider] ?? id.provider;
                        return (
                          <li
                            key={id.id}
                            className="flex items-center justify-between rounded-md border px-3 py-2"
                          >
                            <div className="flex items-center gap-3">
                              <BrandIcon
                                provider={id.provider}
                                className="size-5"
                              />
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">
                                  {label}
                                </span>
                                {id.providerUserId && (
                                  <span className="text-muted-foreground font-mono text-xs">
                                    {id.providerUserId}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="destructive"
                              size="sm"
                              loading={removeIdentity.loading}
                              onClick={() => removeIdentity.run(id)}
                            >
                              <Trash2 className="size-4" />
                              {tr("admin.userDetail.remove", {
                                default: "Remove",
                              })}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {tab === "sessions" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <AlephaTable<SessionResource>
              className="min-h-0 flex-1"
              persistenceKey={`admin.userDetail.${userId}.sessions`}
              fetch={sessionsFetcher}
              bulkActions={[
                {
                  label: tr("admin.userDetail.revokeSelected", {
                    default: "Revoke selected",
                  }),
                  icon: LogOut,
                  destructive: true,
                  onClick: (items, ctx) => bulkRevokeSessions.run(items, ctx),
                },
              ]}
              columns={{
                ip: {
                  label: tr("admin.userDetail.colIp", { default: "IP" }),
                  cell: (s) => <code className="text-xs">{s.ip ?? "—"}</code>,
                },
                userAgent: {
                  label: tr("admin.userDetail.colDevice", {
                    default: "Device",
                  }),
                  cell: (s) => {
                    const ua = s.userAgent;
                    const text = ua
                      ? [ua.browser, ua.os].filter(Boolean).join(" • ") || "—"
                      : "—";
                    return (
                      <span className="text-muted-foreground line-clamp-1 text-xs">
                        {text}
                      </span>
                    );
                  },
                },
                createdAt: {
                  label: tr("admin.userDetail.colStarted", {
                    default: "Started",
                  }),
                  sortable: true,
                  cell: (s) => (
                    <span className="text-muted-foreground text-xs">
                      {String(l(s.createdAt, { date: "fromNow" }))}
                    </span>
                  ),
                },
              }}
              rowActions={(s) => [
                {
                  label: tr("admin.userDetail.revoke", { default: "Revoke" }),
                  icon: LogOut,
                  destructive: true,
                  onClick: (_s, ctx) => revokeSession.run(s, ctx.refresh),
                },
              ]}
            />
          </div>
        )}

        {tab === "audits" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <AlephaTable<AuditEntity>
              className="min-h-0 flex-1"
              persistenceKey={`admin.userDetail.${userId}.audits`}
              fetch={auditsFetcher}
              columns={{
                createdAt: {
                  label: tr("admin.userDetail.colWhen", {
                    default: "When",
                  }),
                  sortable: true,
                  cell: (a) => (
                    <span className="text-muted-foreground text-xs">
                      {String(l(a.createdAt, { date: "fromNow" }))}
                    </span>
                  ),
                },
                action: {
                  label: tr("admin.userDetail.colAction", {
                    default: "Action",
                  }),
                  cell: (a) => (
                    <code className="text-xs font-medium">{a.action}</code>
                  ),
                },
                resource: {
                  label: tr("admin.userDetail.colResource", {
                    default: "Resource",
                  }),
                  cell: (a) => (
                    <span className="font-mono text-xs">
                      {a.resourceType
                        ? `${a.resourceType}:${a.resourceId ?? "—"}`
                        : "—"}
                    </span>
                  ),
                },
                status: {
                  label: tr("admin.userDetail.colAuditStatus", {
                    default: "Status",
                  }),
                  cell: (a) => (
                    <Badge variant={a.success ? "default" : "destructive"}>
                      {a.success
                        ? tr("admin.userDetail.ok", { default: "OK" })
                        : tr("admin.userDetail.failed", {
                            default: "Failed",
                          })}
                    </Badge>
                  ),
                },
              }}
            />
          </div>
        )}
      </div>

      {/* Set password dialog ------------------------------------------- */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("admin.userDetail.setPasswordTitle", {
                default: "Set new password",
              })}
            </DialogTitle>
            <DialogDescription>
              {tr("admin.userDetail.setPasswordSub", {
                default:
                  "The user can sign in with this password immediately. Existing sessions are not revoked.",
              })}
            </DialogDescription>
          </DialogHeader>
          <form
            {...passwordForm.props}
            className="flex flex-col gap-4"
            id="set-password-form"
          >
            <Control
              label={tr("admin.userDetail.newPassword", {
                default: "New password",
              })}
              input={passwordForm.input.password}
              password
            />
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPasswordOpen(false)}
            >
              {tr("admin.userDetail.cancel", { default: "Cancel" })}
            </Button>
            <Button
              type="submit"
              form="set-password-form"
              loading={passwordSubmitting}
            >
              <Ban className="hidden" />
              {tr("admin.userDetail.savePassword", { default: "Save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AdminUserDetail;
