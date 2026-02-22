import { Flex, Text, useDialog, useToast } from "@alepha/ui";
import { Loader } from "@mantine/core";
import { IconBan, IconShieldCheck, IconTrash } from "@tabler/icons-react";
import { t } from "alepha";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AdminRouter } from "../../AdminRouter.ts";
import AdminResourceHeader from "../shared/AdminResourceHeader.tsx";
import AdminResourceTabs from "../shared/AdminResourceTabs.tsx";

export interface AdminUserLayoutProps {
  userRealmName?: string;
}

interface UserContextValue {
  user: UserEntity;
  reload: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export const useUser = () => {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within AdminUserLayout");
  return ctx;
};

const updateUserSchema = t.object({
  email: t.optional(t.email()),
  phoneNumber: t.optional(t.e164()),
  firstName: t.optional(t.string()),
  lastName: t.optional(t.string()),
  roles: t.optional(t.array(t.string())),
  enabled: t.optional(t.boolean()),
});

const displayName = (u: UserEntity) =>
  u.firstName || u.lastName
    ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()
    : u.username || u.email || "User";

const AdminUserLayout = (props: AdminUserLayoutProps) => {
  const router = useRouter<AdminRouter>();
  const state = useRouterState();
  const client = useClient<AdminUserController>();
  const dialog = useDialog();
  const toast = useToast();
  const userId = state.params.userId as string;

  const [user, setUser] = useState<UserEntity | null>(null);
  const [loading, setLoading] = useState(true);

  const realmQuery = { userRealmName: props.userRealmName };

  const loadUser = useCallback(async () => {
    setLoading(true);
    try {
      const data = await client.getUser({
        params: { id: userId },
        query: realmQuery,
      });
      setUser(data);
    } finally {
      setLoading(false);
    }
  }, [userId, client]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const handleToggleEnabled = async () => {
    if (!user) return;
    const action = user.enabled ? "disable" : "enable";
    const confirmed = await dialog.confirm({
      title: `${user.enabled ? "Disable" : "Enable"} User`,
      message: `Are you sure you want to ${action} ${displayName(user)}?`,
    });
    if (confirmed) {
      const updated = await client.updateUser({
        params: { id: user.id },
        query: realmQuery,
        body: { enabled: !user.enabled },
      });
      setUser(updated);
      toast.success({ title: `User ${action}d` });
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    const confirmed = await dialog.confirm({
      title: "Delete User",
      message: `Are you sure you want to delete ${displayName(user)}? This cannot be undone.`,
      confirmColor: "red",
      confirmLabel: "Delete",
    });
    if (confirmed) {
      await client.deleteUser({
        params: { id: user.id },
        query: realmQuery,
      });
      toast.success({ title: "User deleted" });
      router.push("adminUsers");
    }
  };

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!user) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">User not found</Text>
      </Flex>
    );
  }

  return (
    <UserContext.Provider value={{ user, reload: loadUser }}>
      <Flex flex={1} direction="column" gap="lg" p="md">
        <AdminResourceHeader
          backHref={router.path("adminUsers")}
          backLabel="Users"
          title={displayName(user)}
          subtitle={user.email || user.username}
          status={{
            label: user.enabled ? "Active" : "Disabled",
            color: user.enabled ? "green" : "gray",
          }}
          menuActions={[
            {
              label: user.enabled ? "Disable" : "Enable",
              icon: user.enabled ? IconBan : IconShieldCheck,
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
    </UserContext.Provider>
  );
};

export default AdminUserLayout;
