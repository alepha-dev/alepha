import { ActionButton, Flex, Text } from "@alepha/ui";
import { Alert, Card, Loader } from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconMail,
  IconTrash,
} from "@tabler/icons-react";
import type {
  AdminUserController,
  UserController,
  UserEntity,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { useRouter, useRouterState } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { AdminRouter } from "../../AdminRouter.ts";

export interface AdminUserSettingsProps {
  userRealmName?: string;
}

const AdminUserSettings = (props: AdminUserSettingsProps) => {
  const router = useRouter<AdminRouter>();
  const state = useRouterState();
  const adminClient = useClient<AdminUserController>();
  const userClient = useClient<UserController>();
  const userId = state.params.userId as string;

  const [user, setUser] = useState<UserEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const data = await adminClient.getUser({
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

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this user?")) {
      return;
    }

    setDeleteLoading(true);
    try {
      await adminClient.deleteUser({
        params: { id: userId },
        query: { userRealmName: props.userRealmName },
      });
      await router.push("adminUsers");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleTriggerEmailVerification = async () => {
    if (!user?.email) return;

    setVerifyLoading(true);
    setVerifySuccess(false);
    try {
      await userClient.requestEmailVerification({
        query: {
          userRealmName: props.userRealmName,
          method: "link",
          verifyUrl: `${window.location.origin}/auth/verify-email`,
        },
        body: { email: user.email },
      });
      setVerifySuccess(true);
    } finally {
      setVerifyLoading(false);
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
    <Flex flex={1} direction="column" gap="md">
      {user.email && !user.emailVerified && (
        <Card withBorder p="lg">
          <Flex direction="column" gap="md">
            <Text size="lg" fw={500}>
              Email Verification
            </Text>

            <Alert variant="light" color="yellow" icon={<IconMail />}>
              <Text size="sm">
                This user's email ({user.email}) is not verified. You can send a
                verification link to the user.
              </Text>
            </Alert>

            {verifySuccess && (
              <Alert variant="light" color="green" icon={<IconCheck />}>
                <Text size="sm">
                  Verification link sent successfully to {user.email}.
                </Text>
              </Alert>
            )}

            <Flex>
              <ActionButton
                leftSection={<IconMail size={16} />}
                loading={verifyLoading}
                onClick={handleTriggerEmailVerification}
              >
                Send Verification Link
              </ActionButton>
            </Flex>
          </Flex>
        </Card>
      )}

      <Card withBorder p="lg">
        <Flex direction="column" gap="md">
          <Text size="lg" fw={500} c="red">
            Danger Zone
          </Text>

          <Alert variant="light" color="red" icon={<IconAlertCircle />}>
            <Text size="sm">
              Deleting this user will permanently remove their account and all
              associated data. This action cannot be undone.
            </Text>
          </Alert>

          <Flex>
            <ActionButton
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={deleteLoading}
              onClick={handleDelete}
            >
              Delete User
            </ActionButton>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
};

export default AdminUserSettings;
