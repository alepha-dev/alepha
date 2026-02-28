import { ActionButton, Flex, Text, useToast } from "@alepha/ui";
import { Badge, Card, Title } from "@mantine/core";
import { IconCheck, IconMail, IconX } from "@tabler/icons-react";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";

export interface MyInvitationsProps {
  invitations: Array<{
    id: string;
    projectId: number;
    projectTitle: string;
    invitedBy: string;
    inviterName?: string;
    inviterEmail?: string;
    status: "pending" | "accepted" | "rejected";
    createdAt: string;
  }>;
}

const MyInvitations = (props: MyInvitationsProps) => {
  const [invitations, setInvitations] = useState(props.invitations);
  const invitationApi = useClient<InvitationController>();
  const projectApi = useClient<ProjectController>();
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {},
  );
  const alepha = useAlepha();
  const toast = useToast();
  const { l } = useI18n();

  const handleAccept = async (invitationId: string) => {
    setLoadingStates((prev) => ({ ...prev, [invitationId]: true }));
    try {
      await invitationApi.acceptInvitation({
        params: { id: invitationId },
      });

      setInvitations(await invitationApi.getMyInvitations());
      alepha.store.set(userProjectsAtom, await projectApi.getMyProjects());

      toast.success({
        message:
          "You have joined the project! A character has been created for you.",
      });
    } catch (error: any) {
      toast.danger({
        message: error.message || "Failed to accept invitation",
      });
    } finally {
      setLoadingStates((prev) => ({ ...prev, [invitationId]: false }));
    }
  };

  const handleReject = async (invitationId: string) => {
    setLoadingStates((prev) => ({ ...prev, [invitationId]: true }));
    try {
      await invitationApi.rejectInvitation({
        params: { id: invitationId },
      });

      setInvitations(await invitationApi.getMyInvitations());

      toast.warning({
        message: "The invitation has been declined.",
      });
    } catch (error: any) {
      toast.danger({
        message: error.message || "Failed to reject invitation",
      });
    } finally {
      setLoadingStates((prev) => ({ ...prev, [invitationId]: false }));
    }
  };

  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending",
  );
  const processedInvitations = invitations.filter(
    (inv) => inv.status !== "pending",
  );

  if (!invitations || invitations.length === 0) {
    return (
      <Flex
        bg={"var(--alepha-ground)"}
        flex={1}
        align="center"
        justify="center"
      >
        <Flex direction="column" align="center" gap="md">
          <IconMail size={48} opacity={0.5} />
          <Text c="dimmed" size="lg" ta="center">
            No invitations found
          </Text>
          <Text c="dimmed" size="sm" ta="center">
            When someone invites you to join their project, it will appear here.
          </Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex bg={"var(--alepha-ground)"} flex={1} p="lg">
      <Flex direction="column" w="100%" maw={800}>
        <Flex gap="sm" align="center">
          <IconMail size={24} />
          <Title order={2}>My Invitations</Title>
          <Badge variant="light" color="blue">
            {invitations.length}{" "}
            {invitations.length === 1 ? "invitation" : "invitations"}
          </Badge>
        </Flex>

        {pendingInvitations.length > 0 && (
          <Flex direction="column" gap="md">
            <Text size="lg" fw={500}>
              Pending Invitations
            </Text>
            {pendingInvitations.map((invitation) => (
              <Card
                key={invitation.id}
                shadow="sm"
                padding="lg"
                radius="md"
                withBorder
                style={{
                  borderLeft: "4px solid var(--mantine-color-orange-6)",
                }}
              >
                <Flex direction="column" gap="md">
                  <Flex justify="space-between" align="flex-start">
                    <Flex direction="column" gap="xs" flex={1}>
                      <Flex gap="sm">
                        <Title order={4}>{invitation.projectTitle}</Title>
                        <Badge variant="light" color="orange">
                          Pending
                        </Badge>
                      </Flex>
                      <Text size="sm" c="dimmed">
                        Invited by{" "}
                        {invitation.inviterName || invitation.inviterEmail}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Received: {l(invitation.createdAt)}
                      </Text>
                    </Flex>
                  </Flex>

                  <Flex gap="sm">
                    <ActionButton
                      leftSection={<IconCheck size={16} />}
                      color="green"
                      onClick={() => handleAccept(invitation.id)}
                      loading={loadingStates[invitation.id]}
                      disabled={Object.values(loadingStates).some(Boolean)}
                    >
                      Accept
                    </ActionButton>
                    <ActionButton
                      leftSection={<IconX size={16} />}
                      variant="light"
                      color="red"
                      onClick={() => handleReject(invitation.id)}
                      loading={loadingStates[invitation.id]}
                      disabled={Object.values(loadingStates).some(Boolean)}
                    >
                      Reject
                    </ActionButton>
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
        )}

        {processedInvitations.length > 0 && (
          <Flex direction="column" gap="md">
            <Text size="lg" fw={500}>
              Previous Invitations
            </Text>
            {processedInvitations.map((invitation) => (
              <Card
                key={invitation.id}
                shadow="sm"
                padding="lg"
                radius="md"
                withBorder
                style={{
                  opacity: 0.7,
                  borderLeft:
                    invitation.status === "accepted"
                      ? "4px solid var(--mantine-color-green-6)"
                      : "4px solid var(--mantine-color-red-6)",
                }}
              >
                <Flex justify="space-between" align="flex-start">
                  <Flex direction="column" gap="xs" flex={1}>
                    <Flex gap="sm">
                      <Title order={4}>{invitation.projectTitle}</Title>
                      <Badge
                        variant="light"
                        color={
                          invitation.status === "accepted" ? "green" : "red"
                        }
                      >
                        {invitation.status === "accepted"
                          ? "Accepted"
                          : "Rejected"}
                      </Badge>
                    </Flex>
                    <Text size="sm" c="dimmed">
                      Invited by{" "}
                      {invitation.inviterName || invitation.inviterEmail}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Received: {l(invitation.createdAt)}
                    </Text>
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};

export default MyInvitations;
