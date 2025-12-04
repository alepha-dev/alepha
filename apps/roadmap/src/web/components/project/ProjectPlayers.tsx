import { useClient, useInject } from "@alepha/react";
import { useAuth } from "@alepha/react/auth";
import { Localize, useI18n } from "@alepha/react/i18n";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Flex,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconCircleFilled,
  IconCrown,
  IconMail,
  IconPlus,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import type { InvitationController } from "../../../api/controllers/InvitationController.ts";
import type { Character } from "../../../api/entities/characters.ts";
import type { Invitation } from "../../../api/entities/invitations.ts";
import type { Project } from "../../../api/entities/projects.ts";
import type { User } from "../../../api/entities/users.ts";
import { CharacterInfo } from "../../../api/services/CharacterInfo.ts";

export interface ProjectPlayersProps {
  players: Array<Character & { user: User }>;
  project?: Project;
  pendingInvitations?: Array<Invitation>;
}

const ProjectPlayers = (props: ProjectPlayersProps) => {
  const { players, project, pendingInvitations = [] } = props;
  const characterInfo = useInject(CharacterInfo);
  const invitationApi = useClient<InvitationController>();
  const auth = useAuth();
  const { l } = useI18n();

  const [opened, { open, close }] = useDisclosure(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleInvite = async () => {
    if (!project) {
      notifications.show({
        title: "Error",
        message: "Project not found",
        color: "red",
      });
      return;
    }

    if (!email.trim()) {
      notifications.show({
        title: "Error",
        message: "Please enter an email address",
        color: "red",
      });
      return;
    }

    setLoading(true);
    try {
      await invitationApi.createInvitation({
        body: {
          projectId: project.id,
          invitedEmail: email.trim(),
        },
      });

      notifications.show({
        title: "Invitation Sent",
        message: `Invitation sent to ${email}`,
        color: "green",
      });

      setEmail("");
      close();
      // Refresh the page to show new invitation
      window.location.reload();
    } catch (error: any) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to send invitation",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Modal opened={opened} onClose={close} title="Invite Player">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Enter the email address of the player you want to invite to "
            {project?.title || "this project"}"
          </Text>
          <TextInput
            label="Email Address"
            placeholder="player@example.com"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            leftSection={<IconMail size={16} />}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleInvite();
              }
            }}
          />
          <Group gap="sm" justify="flex-end">
            <Button variant="light" onClick={close}>
              Cancel
            </Button>
            <Button onClick={handleInvite} loading={loading}>
              Send Invitation
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Flex flex={1} p="lg" w={"100%"} justify="center">
        <Stack w="100%">
          <Group gap="sm" align="center" justify="space-between">
            <Group gap="sm" align="center">
              <IconUsers size={24} />
              <Title order={2}>Players</Title>
              <Badge variant="light">
                {players.length + pendingInvitations.length}
              </Badge>
            </Group>
            {project && project.createdBy === auth.user?.id && (
              <Button
                variant="light"
                leftSection={<IconPlus size={16} />}
                onClick={open}
              >
                Add Player
              </Button>
            )}
          </Group>

          <Text c="dimmed" size="sm" fs={"italic"}>
            All adventurers participating in this project!
          </Text>

          <Stack gap="md">
            {players.length === 0 && pendingInvitations.length === 0 && (
              <Card shadow="sm" padding="xl" radius="md" withBorder>
                <Flex
                  align="center"
                  justify="center"
                  direction="column"
                  gap="md"
                >
                  <IconUsers size={48} opacity={0.5} />
                  <Text c="dimmed" size="lg" ta="center">
                    No players in this project yet
                  </Text>
                  <Text c="dimmed" size="sm" ta="center">
                    Invite adventurers to join this quest!
                  </Text>
                </Flex>
              </Card>
            )}

            {players.map((player) => {
              const level = characterInfo.getLevelByXp(player.xp);
              const gold = characterInfo.getGold(player.balance);
              const silver = characterInfo.getSilver(player.balance);

              return (
                <Card
                  withBorder
                  key={player.id}
                  shadow="sm"
                  padding="sm"
                  radius="md"
                >
                  <Group gap="lg" align="center">
                    <Avatar
                      src={
                        player.user.picture
                          ? `/api/files/${player.user.picture}`
                          : undefined
                      }
                      size={56}
                      radius="md"
                    >
                      <IconUser size={24} />
                    </Avatar>

                    <Flex direction="column" flex={1}>
                      <Group gap="sm" align="center">
                        <Text fw={500} size="lg">
                          {player.user.username}
                        </Text>
                        {player.owner && (
                          <Badge
                            variant="light"
                            leftSection={<IconCrown size={12} />}
                          >
                            Owner
                          </Badge>
                        )}
                      </Group>

                      <Text size="sm" c="dimmed">
                        {player.user.email}
                      </Text>
                    </Flex>

                    <Flex flex={1} align={"center"} gap="xl">
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed" fw={500}>
                          Level
                        </Text>
                        <Text size="sm" fw={500}>
                          {level}
                        </Text>
                      </Stack>
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed" fw={500}>
                          Experience
                        </Text>
                        <Text size="sm" fw={500}>
                          {l(player.xp)}
                        </Text>
                      </Stack>
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed" fw={500}>
                          Balance
                        </Text>
                        <Group gap={2}>
                          {gold > 0 && (
                            <>
                              <Text size="sm" fw={500}>
                                {gold}
                              </Text>
                              <IconCircleFilled
                                size={10}
                                color="var(--color-gold)"
                              />
                            </>
                          )}
                          {silver > 0 && (
                            <>
                              <Text size="sm" fw={500}>
                                {silver}
                              </Text>
                              <IconCircleFilled
                                size={10}
                                color="var(--color-silver)"
                              />
                            </>
                          )}
                          {gold === 0 && silver === 0 && (
                            <Text size="sm" fw={500}>
                              0
                            </Text>
                          )}
                        </Group>
                      </Stack>
                    </Flex>

                    <Text size="xs" c="dimmed">
                      Joined{" "}
                      <Localize value={player.createdAt} date="fromNow" />
                    </Text>
                  </Group>
                </Card>
              );
            })}

            {pendingInvitations.map((invitation) => (
              <Card
                key={invitation.id}
                shadow="sm"
                padding="lg"
                radius="md"
                withBorder
                style={{ opacity: 0.6 }}
              >
                <Group gap="lg" align="flex-start">
                  <Avatar size={56} radius="md" color="gray">
                    <IconMail size={24} />
                  </Avatar>

                  <Stack gap="xs" flex={1}>
                    <Group gap="sm" align="center">
                      <Text fw={500} size="lg">
                        {invitation.invitedEmail}
                      </Text>
                      <Badge variant="light">Pending</Badge>
                    </Group>

                    <Text size="sm" c="dimmed">
                      Invitation sent
                    </Text>

                    <Text size="xs" c="dimmed">
                      Sent{" "}
                      <Localize value={invitation.createdAt} date="fromNow" />
                    </Text>
                  </Stack>
                </Group>
              </Card>
            ))}
          </Stack>
        </Stack>
      </Flex>
    </>
  );
};

export default ProjectPlayers;
