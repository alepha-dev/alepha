import * as React from "react";

void React;

import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Control } from "@alepha/ui/components/control/control";
import { Avatar, AvatarFallback } from "@alepha/ui/components/ui/avatar";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Separator } from "@alepha/ui/components/ui/separator";
import { Skeleton } from "@alepha/ui/components/ui/skeleton";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { type Page, type Static, t } from "alepha";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import type {
  AdminIdentityController,
  AdminSessionController,
  AdminUserController,
  IdentityResource,
  SessionResource,
  UserResource,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { FormValidationError, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { HttpError } from "alepha/server";
import {
  ArrowLeft,
  Ban,
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
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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

interface RoleMeta {
  name: string;
  default?: boolean;
  description?: string;
}

const profileSchema = t.object({
  username: t.optional(t.string()),
  email: t.optional(t.string()),
  emailVerified: t.optional(t.boolean()),
  firstName: t.optional(t.string()),
  lastName: t.optional(t.string()),
  roles: t.optional(t.array(t.string())),
});
type ProfileForm = Static<typeof profileSchema>;

const passwordSchema = t.object({
  password: t.string({ minLength: 6 }),
});

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
  const { user: currentUser } = useAuth();
  const dialog = useDialog();

  const [user, setUser] = useState<UserResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableRoles, setAvailableRoles] = useState<RoleMeta[]>([]);
  const [identities, setIdentities] = useState<IdentityResource[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [tab, setTab] = useState<
    "overview" | "security" | "sessions" | "audits"
  >("overview");

  const isSelf = currentUser?.id === userId;
  const backPath = props.backPath ?? "/admin/users";

  // -- Load user, roles, identities -----------------------------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const u = (await userClient.getUser({
        params: { id: userId },
        query: { userRealmName: props.userRealmName },
      } as never)) as UserResource;
      if (cancelled) return;
      setUser(u);
      setLoading(false);
    })().catch((err) => {
      if (cancelled) return;
      setLoading(false);
      toast.error(
        tr("admin.userDetail.loadError", {
          default: "Failed to load user",
        }),
      );
      console.error(err);
    });
    return () => {
      cancelled = true;
    };
  }, [userClient, userId, props.userRealmName, reloadKey, tr]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const roles = (await userClient.findRoles({
        query: { userRealmName: props.userRealmName },
      } as never)) as RoleMeta[];
      if (!cancelled) setAvailableRoles(roles);
    })().catch(() => {
      // role metadata fetch failure isn't blocking
    });
    return () => {
      cancelled = true;
    };
  }, [userClient, props.userRealmName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = (await identityClient.findIdentities({
        query: {
          userId,
          size: 100,
          userRealmName: props.userRealmName,
        } as never,
      })) as Page<IdentityResource>;
      if (!cancelled) setIdentities(res.content);
    })().catch(() => {
      // identities fetch may fail if the controller isn't mounted; ignore
    });
    return () => {
      cancelled = true;
    };
  }, [identityClient, userId, props.userRealmName, reloadKey]);

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

      const body: Record<string, unknown> = {
        username,
        email,
        firstName: (values.firstName ?? "").trim(),
        lastName: (values.lastName ?? "").trim(),
        roles: values.roles ?? [],
      };

      // Changing the email invalidates the verified flag — server-side
      // enforcement is also recommended, but mirror it client-side so
      // the UI is immediately consistent.
      const emailChanged = user && email !== (user.email ?? "");
      body.emailVerified = emailChanged ? false : Boolean(values.emailVerified);

      try {
        await userClient.updateUser({
          params: { id: userId },
          query: { userRealmName: props.userRealmName },
          body: body as never,
        } as never);
        toast.success(
          tr("admin.userDetail.saved", { default: "Profile saved" }),
        );
        setReloadKey((k) => k + 1);
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
  }, [user?.id, reloadKey]);

  // -- Set password ---------------------------------------------------------

  const passwordForm = useForm({
    schema: passwordSchema,
    handler: async ({ password }) => {
      await (userClient as any).setUserPassword({
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

  // -- Enable/disable -------------------------------------------------------

  const handleToggleEnabled = async () => {
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
      body: { enabled: enable } as never,
    } as never);
    setReloadKey((k) => k + 1);
    toast.success(
      enable
        ? tr("admin.userDetail.enabled", { default: "User enabled" })
        : tr("admin.userDetail.disabled", { default: "User disabled" }),
    );
  };

  // -- Delete ---------------------------------------------------------------

  const handleDelete = async () => {
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
    } as never);
    toast.success(tr("admin.userDetail.deleted", { default: "User deleted" }));
    await router.push(backPath as never);
  };

  // -- Remove social auth ---------------------------------------------------

  const handleRemoveIdentity = async (identity: IdentityResource) => {
    const provider = PROVIDER_LABELS[identity.provider] ?? identity.provider;
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
    } as never);
    toast.success(
      tr("admin.userDetail.identityRemoved", {
        default: "Connection removed",
      }),
    );
    setReloadKey((k) => k + 1);
  };

  // -- Sessions / audits fetchers -------------------------------------------

  const sessionsFetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await sessionClient.findSessions({
        query: {
          ...params,
          userId,
          userRealmName: props.userRealmName,
        } as never,
      });
      return res as Page<SessionResource>;
    },
    [sessionClient, userId, props.userRealmName, reloadKey],
  );

  const auditsFetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await auditClient.findByUser({
        params: { userId },
        query: params as never,
      });
      return res as Page<AuditEntity>;
    },
    [auditClient, userId, reloadKey],
  );

  const handleRevokeSession = async (
    s: SessionResource,
    refresh: () => void,
  ) => {
    const ok = await dialog.confirm({
      title: tr("admin.userDetail.revokeTitle", { default: "Revoke session" }),
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
    } as never);
    refresh();
  };

  const handleBulkRevokeSessions = async (
    items: SessionResource[],
    ctx: { refresh: () => void; clearSelection: () => void },
  ) => {
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
    } as never);
    ctx.clearSelection();
    ctx.refresh();
  };

  // -- Render ---------------------------------------------------------------

  if (loading && !user) {
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
        <Button
          variant="outline"
          onClick={() => router.push(backPath as never)}
        >
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

  const identityHero = (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar className="size-20 text-xl">
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
      <div className="flex w-full flex-col items-center gap-1">
        <h1
          className="w-full truncate text-base font-semibold tracking-tight"
          title={String(displayName)}
        >
          {displayName}
        </h1>
        {user.username && (
          <span
            className="text-muted-foreground w-full truncate font-mono text-xs"
            title={`@${user.username}`}
          >
            @{user.username}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Badge variant={user.enabled ? "default" : "destructive"}>
          {user.enabled
            ? tr("admin.userDetail.active", { default: "Active" })
            : tr("admin.userDetail.disabledBadge", {
                default: "Disabled",
              })}
        </Badge>
        {user.emailVerified && (
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="size-3.5" />
            {tr("admin.userDetail.verified", { default: "Verified" })}
          </Badge>
        )}
      </div>
      <span
        className="text-muted-foreground font-mono text-[11px]"
        title={user.id}
      >
        {user.id.slice(0, 8)}…
      </span>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Aside (full height) ------------------------------------------- */}
      <aside className="border-border bg-background hidden w-72 shrink-0 flex-col gap-4 overflow-auto border-r p-6 md:flex">
        <button
          type="button"
          onClick={() => router.push(backPath as never)}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          {tr("admin.userDetail.back", { default: "Back to users" })}
        </button>
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
        </div>
        {tab === "overview" && (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex max-w-4xl flex-col gap-6 p-6">
              {/* Profile -------------------------------------------------- */}
              <AutoForm
                form={form}
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
            <div className="flex max-w-4xl flex-col gap-6 p-6">
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
                      default: "Linked credentials and OAuth providers.",
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {identities.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {tr("admin.userDetail.noIdentities", {
                        default: "No connected accounts.",
                      })}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {identities.map((id) => {
                        const label =
                          PROVIDER_LABELS[id.provider] ?? id.provider;
                        return (
                          <li
                            key={id.id}
                            className="flex items-center justify-between rounded-md border px-3 py-2"
                          >
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveIdentity(id)}
                              className="text-destructive hover:text-destructive"
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

              {/* Actions -------------------------------------------------------- */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {tr("admin.userDetail.actions", { default: "Actions" })}
                  </CardTitle>
                  <CardDescription>
                    {tr("admin.userDetail.actionsSub", {
                      default: "Administrative operations on this account.",
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setPasswordOpen(true)}
                  >
                    <KeyRound className="size-4" />
                    {tr("admin.userDetail.setPassword", {
                      default: "Set password",
                    })}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isSelf}
                    onClick={handleToggleEnabled}
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
                  <Separator orientation="vertical" className="h-9" />
                  <Button
                    variant="destructive"
                    disabled={isSelf}
                    onClick={handleDelete}
                  >
                    <Trash2 className="size-4" />
                    {tr("admin.userDetail.delete", { default: "Delete user" })}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {tab === "sessions" && (
          <div className="min-h-0 flex-1 overflow-hidden p-6">
            {/* Sessions ------------------------------------------------------ */}
            <Card className="flex h-full flex-col">
              <CardHeader>
                <CardTitle>
                  {tr("admin.userDetail.sessions", { default: "Sessions" })}
                </CardTitle>
                <CardDescription>
                  {tr("admin.userDetail.sessionsSub", {
                    default: "Active and revoked sessions for this user.",
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AlephaTable<SessionResource>
                  persistenceKey={`admin.userDetail.${userId}.sessions`}
                  fetch={sessionsFetcher}
                  bulkActions={[
                    {
                      label: tr("admin.userDetail.revokeSelected", {
                        default: "Revoke selected",
                      }),
                      icon: LogOut,
                      destructive: true,
                      onClick: handleBulkRevokeSessions,
                    },
                  ]}
                  columns={{
                    ip: {
                      label: tr("admin.userDetail.colIp", { default: "IP" }),
                      cell: (s) => (
                        <code className="text-xs">{s.ip ?? "—"}</code>
                      ),
                    },
                    userAgent: {
                      label: tr("admin.userDetail.colDevice", {
                        default: "Device",
                      }),
                      cell: (s) => {
                        const ua = s.userAgent;
                        const text = ua
                          ? [ua.browser, ua.os].filter(Boolean).join(" • ") ||
                            "—"
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
                    status: {
                      label: tr("admin.userDetail.colStatus", {
                        default: "Status",
                      }),
                      cell: (s) => (
                        <Badge
                          variant={(s as any).revokedAt ? "outline" : "default"}
                        >
                          {(s as any).revokedAt
                            ? tr("admin.userDetail.revoked", {
                                default: "Revoked",
                              })
                            : tr("admin.userDetail.activeBadge", {
                                default: "Active",
                              })}
                        </Badge>
                      ),
                    },
                  }}
                  rowActions={(s) =>
                    (s as any).revokedAt
                      ? []
                      : [
                          {
                            label: tr("admin.userDetail.revoke", {
                              default: "Revoke",
                            }),
                            icon: LogOut,
                            destructive: true,
                            onClick: (_s, ctx) =>
                              handleRevokeSession(s, ctx.refresh),
                          },
                        ]
                  }
                />
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "audits" && (
          <div className="min-h-0 flex-1 overflow-hidden p-6">
            {/* Audit log ----------------------------------------------------- */}
            <Card className="flex h-full flex-col">
              <CardHeader>
                <CardTitle>
                  {tr("admin.userDetail.audits", { default: "Audit log" })}
                </CardTitle>
                <CardDescription>
                  {tr("admin.userDetail.auditsSub", {
                    default: "Recent API actions touching this user.",
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AlephaTable<AuditEntity>
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
              </CardContent>
            </Card>
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
              disabled={passwordForm.submitting}
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
