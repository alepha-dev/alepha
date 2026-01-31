import { Box, Center, Loader, Stack, Text } from "@mantine/core";
import {
  IconBan,
  IconDevices,
  IconHistory,
  IconLock,
  IconMail,
  IconPencil,
  IconSettings,
  IconShieldCheck,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { AdminRouter } from "../../AdminRouter.ts";
import AdminResourceHeader from "../shared/AdminResourceHeader.tsx";
import AdminResourceTabs from "../shared/AdminResourceTabs.tsx";

export interface AdminUserLayoutProps {
  userRealmName?: string;
}

const AdminUserLayout = (props: AdminUserLayoutProps) => {
  const router = useRouter<AdminRouter>();
  const state = useRouterState();
  const client = useClient<AdminUserController>();
  const userId = state.params.userId as string;

  const [user, setUser] = useState<UserEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const data = await client.getUser({
          params: { id: userId },
          query: { userRealmName: props.userRealmName },
        });
        setUser(data);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, [userId]);

  if (loading) {
    return (
      <Center flex={1}>
        <Loader />
      </Center>
    );
  }

  if (!user) {
    return (
      <Center flex={1}>
        <Stack align="center" gap="xs">
          <IconUser size={48} opacity={0.3} />
          <Text c="dimmed">User not found</Text>
        </Stack>
      </Center>
    );
  }

  const displayName =
    user.firstName || user.lastName
      ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
      : user.username || user.email || "User";

  const currentPath = state.url.pathname;
  const getActiveTab = () => {
    if (currentPath.endsWith("/sessions")) return "sessions";
    if (currentPath.endsWith("/settings")) return "settings";
    if (currentPath.endsWith("/audits")) return "audits";
    return "profile";
  };

  const handleBlockUser = async () => {
    setActionLoading("block");
    try {
      const updated = await client.updateUser({
        params: { id: userId },
        query: { userRealmName: props.userRealmName },
        body: { enabled: !user.enabled },
      });
      setUser(updated);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendVerification = async () => {
    setActionLoading("verify");
    // TODO: Implement send verification
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setActionLoading(null);
  };

  const handleResetPassword = async () => {
    setActionLoading("reset");
    // TODO: Implement reset password
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setActionLoading(null);
  };

  const handleDeleteUser = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this user? This action cannot be undone.",
      )
    ) {
      return;
    }
    setActionLoading("delete");
    try {
      await client.deleteUser({
        params: { id: userId },
        query: { userRealmName: props.userRealmName },
      });
      await router.push("adminUsers");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Box py="xl" px="xl" flex={1}>
      <Stack gap="lg">
        <AdminResourceHeader
          backHref={router.path("adminUsers")}
          backLabel="Users"
          avatar={user.picture || displayName.charAt(0).toUpperCase()}
          avatarColor={user.enabled ? "blue" : "gray"}
          title={displayName}
          subtitle={user.email || user.username || undefined}
          status={{
            label: user.enabled ? "Active" : "Disabled",
            color: user.enabled ? "green" : "red",
          }}
          menuActions={[
            {
              label: "Edit Profile",
              icon: IconPencil,
              href: router.path("adminUserDetails", { params: { userId } }),
            },
            {
              label: user.enabled ? "Disable User" : "Enable User",
              icon: user.enabled ? IconBan : IconShieldCheck,
              color: user.enabled ? "orange" : "green",
              onClick: handleBlockUser,
              loading: actionLoading === "block",
            },
            ...(user.email && !user.emailVerified
              ? [
                  {
                    label: "Send Verification Email",
                    icon: IconMail,
                    onClick: handleSendVerification,
                    loading: actionLoading === "verify",
                  },
                ]
              : []),
            {
              label: "Reset Password",
              icon: IconLock,
              onClick: handleResetPassword,
              loading: actionLoading === "reset",
            },
            {
              label: "Delete User",
              icon: IconTrash,
              color: "red",
              onClick: handleDeleteUser,
              loading: actionLoading === "delete",
            },
          ]}
        />

        <AdminResourceTabs
          activeTab={getActiveTab()}
          tabs={[
            {
              value: "profile",
              label: "Profile",
              icon: IconUser,
              href: router.path("adminUserDetails", { params: { userId } }),
            },
            {
              value: "sessions",
              label: "Sessions",
              icon: IconDevices,
              href: router.path("adminUserSessions", { params: { userId } }),
            },
            {
              value: "audits",
              label: "Activity",
              icon: IconHistory,
              href: router.path("adminUserAudits", { params: { userId } }),
            },
            {
              value: "settings",
              label: "Settings",
              icon: IconSettings,
              href: router.path("adminUserSettings", { params: { userId } }),
            },
          ]}
        />

        <NestedView />
      </Stack>
    </Box>
  );
};

export default AdminUserLayout;
