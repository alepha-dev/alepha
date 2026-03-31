import { Flex, useDialog, useToast } from "@alepha/ui";
import { AdminResourceHeader, AdminResourceTabs } from "@alepha/ui/admin";
import { IconBan, IconShieldCheck, IconTrash } from "@tabler/icons-react";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useAlepha, useClient, useStore } from "alepha/react";
import { NestedView, useRouter } from "alepha/react/router";
import { useCallback, useEffect } from "react";
import type { AdminUserRouter } from "../AdminUserRouter.tsx";
import { adminUserAtom } from "../atoms/adminUserAtom.ts";

export interface AdminUserLayoutProps {
  user: UserEntity;
  userRealmName?: string;
}

const displayName = (u: UserEntity) =>
  u.firstName || u.lastName
    ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()
    : u.username || u.email || "User";

const AdminUserLayout = (props: AdminUserLayoutProps) => {
  const router = useRouter<AdminUserRouter>();
  const client = useClient<AdminUserController>();
  const alepha = useAlepha();
  const dialog = useDialog();
  const toast = useToast();
  const [user] = useStore(adminUserAtom);

  useEffect(() => {
    alepha.store.set(adminUserAtom, props.user);
  }, [props.user]);

  const currentUser = user ?? props.user;
  const userId = currentUser.id;
  const realmQuery = { userRealmName: props.userRealmName };

  const reload = useCallback(async () => {
    const data = await client.getUser({
      params: { id: userId },
      query: realmQuery,
    });
    alepha.store.set(adminUserAtom, data);
  }, [userId, client]);

  const handleToggleEnabled = async () => {
    const action = currentUser.enabled ? "disable" : "enable";
    const confirmed = await dialog.confirm({
      title: `${currentUser.enabled ? "Disable" : "Enable"} User`,
      message: `Are you sure you want to ${action} ${displayName(currentUser)}?`,
    });
    if (confirmed) {
      const updated = await client.updateUser({
        params: { id: currentUser.id },
        query: realmQuery,
        body: { enabled: !currentUser.enabled },
      });
      alepha.store.set(adminUserAtom, updated);
      toast.success({ title: `User ${action}d` });
    }
  };

  const handleDelete = async () => {
    const confirmed = await dialog.confirm({
      title: "Delete User",
      message: `Are you sure you want to delete ${displayName(currentUser)}? This cannot be undone.`,
      confirmColor: "red",
      confirmLabel: "Delete",
    });
    if (confirmed) {
      await client.deleteUser({
        params: { id: currentUser.id },
        query: realmQuery,
      });
      toast.success({ title: "User deleted" });
      router.push("adminUsers");
    }
  };

  return (
    <Flex
      flex={1}
      direction="column"
      gap="lg"
      p="md"
      m="md"
      style={{
        backgroundColor: "var(--mantine-color-body)",
        borderRadius: "var(--mantine-radius-md)",
        border: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <AdminResourceHeader
        backHref={router.path("adminUsers")}
        backLabel="Users"
        title={displayName(currentUser)}
        subtitle={currentUser.email || currentUser.username}
        status={{
          label: currentUser.enabled ? "Active" : "Disabled",
          color: currentUser.enabled ? "green" : "gray",
        }}
        menuActions={[
          {
            label: currentUser.enabled ? "Disable" : "Enable",
            icon: currentUser.enabled ? IconBan : IconShieldCheck,
            onClick: handleToggleEnabled,
          },
          {
            label: "Delete",
            icon: IconTrash,
            color: "red",
            onClick: handleDelete,
          },
        ]}
      />

      <AdminResourceTabs
        tabs={[
          {
            value: "profile",
            label: "Profile",
            href: router.path("adminUserProfile", {
              params: { userId },
            }),
          },
          {
            value: "sessions",
            label: "Sessions",
            href: router.path("adminUserSessions", {
              params: { userId },
            }),
          },
        ]}
      />

      <NestedView />
    </Flex>
  );
};

export default AdminUserLayout;
