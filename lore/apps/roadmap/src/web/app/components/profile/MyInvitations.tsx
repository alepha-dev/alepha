import { ActionButton, Flex, Text, useToast } from "@alepha/mantine";
import { Badge } from "@mantine/core";
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
    resourceId: string;
    resourceName: string;
    invitedBy: string;
    inviterName?: string;
    inviterEmail?: string;
    status: "pending" | "accepted" | "declined" | "expired" | "revoked";
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
      await invitationApi.acceptInvitation({ params: { id: invitationId } });
      setInvitations(await invitationApi.getMyInvitations());
      alepha.store.set(userProjectsAtom, await projectApi.getMyProjects());
      toast.success({
        message:
          "You have joined the campaign! A character has been created for you.",
      });
    } catch (error: any) {
      toast.danger({ message: error.message || "Failed to accept invitation" });
    } finally {
      setLoadingStates((prev) => ({ ...prev, [invitationId]: false }));
    }
  };

  const handleDecline = async (invitationId: string) => {
    setLoadingStates((prev) => ({ ...prev, [invitationId]: true }));
    try {
      await invitationApi.declineInvitation({ params: { id: invitationId } });
      setInvitations(await invitationApi.getMyInvitations());
      toast.warning({ message: "The invitation has been declined." });
    } catch (error: any) {
      toast.danger({
        message: error.message || "Failed to decline invitation",
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
        flex={1}
        align="center"
        justify="center"
        direction="column"
        gap="sm"
        py="xl"
      >
        <IconMail size={40} opacity={0.3} />
        <Text c="dimmed" ta="center">
          No invitations yet.
        </Text>
        <Text c="dimmed" size="sm" ta="center">
          When someone invites you to their campaign, it will appear here.
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="lg" flex={1} py="md">
      <Flex align="center" gap="sm">
        <IconMail size={20} />
        <Text size="lg" fw={700}>
          Invitations
        </Text>
        {pendingInvitations.length > 0 && (
          <Badge variant="filled" color="orange" size="sm">
            {pendingInvitations.length} pending
          </Badge>
        )}
      </Flex>

      {/* Pending */}
      {pendingInvitations.length > 0 && (
        <Flex direction="column" gap="sm">
          {pendingInvitations.map((invitation) => (
            <Flex
              key={invitation.id}
              direction="column"
              gap="sm"
              p="md"
              bg="var(--alepha-elevated)"
              style={{
                borderRadius: "var(--mantine-radius-md)",
                border: "1px solid var(--alepha-border)",
                borderLeft: "3px solid var(--mantine-color-orange-6)",
              }}
            >
              <Flex justify="space-between" align="center">
                <Flex direction="column" gap={2}>
                  <Flex align="center" gap="sm">
                    <Text fw={600}>{invitation.resourceName}</Text>
                    <Badge variant="light" color="orange" size="xs">
                      Pending
                    </Badge>
                  </Flex>
                  <Text size="xs" c="dimmed">
                    From {invitation.inviterName || invitation.inviterEmail}{" "}
                    &middot; {l(invitation.createdAt)}
                  </Text>
                </Flex>

                <Flex gap="xs">
                  <ActionButton
                    size="xs"
                    leftSection={<IconCheck size={14} />}
                    color="green"
                    onClick={() => handleAccept(invitation.id)}
                    loading={loadingStates[invitation.id]}
                    disabled={Object.values(loadingStates).some(Boolean)}
                  >
                    Accept
                  </ActionButton>
                  <ActionButton
                    size="xs"
                    leftSection={<IconX size={14} />}
                    variant="light"
                    color="red"
                    onClick={() => handleDecline(invitation.id)}
                    loading={loadingStates[invitation.id]}
                    disabled={Object.values(loadingStates).some(Boolean)}
                  >
                    Decline
                  </ActionButton>
                </Flex>
              </Flex>
            </Flex>
          ))}
        </Flex>
      )}

      {/* Previous */}
      {processedInvitations.length > 0 && (
        <Flex direction="column" gap="sm">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Previous
          </Text>
          {processedInvitations.map((invitation) => (
            <Flex
              key={invitation.id}
              align="center"
              gap="sm"
              p="sm"
              px="md"
              bg="var(--alepha-elevated)"
              style={{
                borderRadius: "var(--mantine-radius-sm)",
                border: "1px solid var(--alepha-border)",
                opacity: 0.7,
                borderLeft: `3px solid var(--mantine-color-${invitation.status === "accepted" ? "green" : "red"}-6)`,
              }}
            >
              <Flex direction="column" gap={0} flex={1}>
                <Text size="sm" fw={500}>
                  {invitation.resourceName}
                </Text>
                <Text size="xs" c="dimmed">
                  {invitation.inviterName || invitation.inviterEmail} &middot;{" "}
                  {l(invitation.createdAt)}
                </Text>
              </Flex>
              <Badge
                variant="light"
                size="xs"
                color={invitation.status === "accepted" ? "green" : "red"}
              >
                {invitation.status.charAt(0).toUpperCase() +
                  invitation.status.slice(1)}
              </Badge>
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
};

export default MyInvitations;
