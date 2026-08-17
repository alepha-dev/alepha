import * as React from "react";

void React;

import {
  AdminDetailLayout,
  type AdminDetailTab,
} from "@alepha/ui/components/admin/admin-detail-layout";
import { AdminUserDetailAuditsTab } from "@alepha/ui/components/admin/admin-user-detail-audits-tab";
import { AdminUserDetailIdentityAside } from "@alepha/ui/components/admin/admin-user-detail-identity-aside";
import { AdminUserDetailOverviewTab } from "@alepha/ui/components/admin/admin-user-detail-overview-tab";
import { AdminUserDetailPasswordDialog } from "@alepha/ui/components/admin/admin-user-detail-password-dialog";
import { AdminUserDetailSecurityTab } from "@alepha/ui/components/admin/admin-user-detail-security-tab";
import { AdminUserDetailSessionsTab } from "@alepha/ui/components/admin/admin-user-detail-sessions-tab";
import { useDetailTab } from "@alepha/ui/components/admin/use-detail-tab";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { AdminAuditController } from "alepha/api/audits";
import type {
  AdminIdentityController,
  AdminSessionController,
  AdminUserController,
  IdentityResource,
  RealmController,
  SessionResource,
} from "alepha/api/users";
import { useAction, useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { HttpError } from "alepha/server";
import {
  History,
  Monitor,
  ShieldCheck,
  Trash2,
  User,
  UserCheck,
  UserX,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PROVIDER_LABELS } from "../auth/provider-labels.ts";
import { passwordSchema } from "./admin-user-detail-password-schema.ts";
import {
  type ProfileIssue,
  profileIssues,
  profilePolicy,
  profileUpdateBody,
} from "./admin-user-detail-profile-policy.ts";
import {
  type ProfileForm,
  profileSchema,
} from "./admin-user-detail-profile-schema.ts";

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

type TabKey = "overview" | "security" | "sessions" | "audits";

/**
 * Resolves the id param for this page, preferring `:userId` (the param name
 * `AdminRouter`'s own route declares) and falling back to `:id` (the name
 * this component read exclusively before `AdminRouter` existed).
 *
 * The fallback exists for `~/git/club/apps/platform`, which vendors
 * `@alepha/ui` and declares its own user-detail route as `/users/:id` against
 * this same component. Without it, that application's next upgrade of
 * `@alepha/ui` would resolve `userId` to `undefined`, fall through to the
 * empty string, and load `AdminUserDetail` with no id at all instead of
 * failing to build.
 */
export const resolveUserDetailId = (params: {
  userId?: string;
  id?: string;
}): string => String(params.userId ?? params.id ?? "");

/**
 * Composition root for the admin user detail page.
 *
 * Owns the data (queries, forms, mutations) and the shell — top bar, tab
 * selection, identity aside. Each tab body lives in its own file beside this
 * one; they render what they are given and hold no fetching of their own.
 */
export const AdminUserDetail = (props: AdminUserDetailProps) => {
  const router = useRouter();
  const routerState = useRouterState();
  const userId = resolveUserDetailId(routerState.params);
  const userClient = useClient<AdminUserController>();
  const sessionClient = useClient<AdminSessionController>();
  const identityClient = useClient<AdminIdentityController>();
  const auditClient = useClient<AdminAuditController>();
  const realmClient = useClient<RealmController>();
  const { tr } = useI18n();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const dialog = useDialog();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [tab, setTab] = useDetailTab<TabKey>("overview");

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

  const realmQuery = useQuery(
    {
      // The realm config query param is `realmName`; the admin endpoints
      // spell the same thing `userRealmName`.
      handler: ({ signal }) =>
        realmClient.getRealmConfig(
          { query: { realmName: props.userRealmName } },
          { request: { signal } },
        ),
      // Realm settings only shape which profile fields are offered — a
      // failure must not block the page. `profilePolicy` degrades to
      // "everything optional" without them.
      onError: () => {},
    },
    [realmClient, props.userRealmName],
  );

  // What the realm collects decides what this form offers and demands.
  // Hardcoding "email is required" here made every save fail — a role change
  // included — on a realm that signs users in by username alone.
  const policy = profilePolicy(realmQuery.data?.settings, user);

  // -- Profile form ---------------------------------------------------------

  const issueMessage = (issue: ProfileIssue): string => {
    if (issue.field === "username") {
      return issue.reason === "required"
        ? tr("admin.userDetail.usernameRequired", {
            default: "Username is required",
          })
        : tr("admin.userDetail.usernameCannotBeCleared", {
            default: "Username cannot be removed once set",
          });
    }
    return issue.reason === "required"
      ? tr("admin.userDetail.emailRequired", {
          default: "Email is required",
        })
      : tr("admin.userDetail.emailCannotBeCleared", {
          default: "Email cannot be removed once set",
        });
  };

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
      // Field guards live in the handler, not in the schema, so useForm's
      // initial decode doesn't crash on the empty mount.
      const issue = profileIssues(values, policy, user)[0];
      if (issue) {
        throw new FormValidationError({
          message: issueMessage(issue),
          path: `/${issue.field}`,
        });
      }

      const body = profileUpdateBody(values, policy, user);

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

  // A `credentials` identity means a password is set. Password sign-in lives
  // in its own card; the social providers are everything else.
  const hasPassword = identities.some((id) => id.provider === "credentials");
  const socialIdentities = identities.filter(
    (id) => id.provider !== "credentials",
  );

  const tabs: AdminDetailTab[] = [
    {
      value: "overview",
      icon: User,
      label: tr("admin.userDetail.tabOverview", { default: "Overview" }),
    },
    {
      value: "security",
      icon: ShieldCheck,
      label: tr("admin.userDetail.tabSecurity", { default: "Security" }),
    },
    {
      value: "sessions",
      icon: Monitor,
      label: tr("admin.userDetail.tabSessions", { default: "Sessions" }),
    },
    {
      value: "audits",
      icon: History,
      label: tr("admin.userDetail.tabAudits", { default: "Audit log" }),
    },
  ];

  return (
    <>
      <AdminDetailLayout
        loading={userQuery.loading && !user}
        notFound={
          user
            ? undefined
            : {
                message: String(
                  tr("admin.userDetail.notFound", {
                    default: "User not found.",
                  }),
                ),
                backLabel: String(
                  tr("admin.userDetail.back", { default: "Back to users" }),
                ),
                onBack: () => void router.push(backPath),
              }
        }
        aside={user ? <AdminUserDetailIdentityAside user={user} /> : null}
        tabs={tabs}
        tab={tab}
        onTabChange={(v) => setTab(v as TabKey)}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              loading={toggleEnabled.loading}
              disabled={isSelf}
              onClick={() => toggleEnabled.run()}
            >
              {user?.enabled ? (
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
          </>
        }
      >
        {tab === "overview" && (
          <AdminUserDetailOverviewTab
            form={form}
            availableRoles={availableRoles}
            policy={policy}
          />
        )}

        {tab === "security" && (
          <AdminUserDetailSecurityTab
            hasPassword={hasPassword}
            socialIdentities={socialIdentities}
            removeIdentity={removeIdentity}
            onChangePassword={() => setPasswordOpen(true)}
          />
        )}

        {tab === "sessions" && (
          <AdminUserDetailSessionsTab
            userId={userId}
            fetch={sessionsFetcher}
            revokeSession={revokeSession}
            bulkRevokeSessions={bulkRevokeSessions}
          />
        )}

        {tab === "audits" && (
          <AdminUserDetailAuditsTab userId={userId} fetch={auditsFetcher} />
        )}
      </AdminDetailLayout>

      <AdminUserDetailPasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        form={passwordForm}
        submitting={passwordSubmitting}
      />
    </>
  );
};

export default AdminUserDetail;
