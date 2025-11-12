import { useClient, useInject } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { useI18n } from "@alepha/react-i18n";
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
  IconCrown,
  IconMail,
  IconPlus,
  IconStar,
  IconTrophy,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import type { InvitationApi } from "../../api/InvitationApi.ts";
import type { Character } from "../../entities/characters.ts";
import type { Invitation } from "../../entities/invitations.ts";
import type { Project } from "../../entities/projects.ts";
import type { User } from "../../entities/users.ts";
import { CharacterInfo } from "../../services/CharacterInfo.ts";

export interface ProjectPlayersProps {
  players: Array<Character & { user: User }>;
  project?: Project;
  pendingInvitations?: Array<Invitation>;
}

const ProjectPlayers = (props: ProjectPlayersProps) => {
  const { players, project, pendingInvitations = [] } = props;
  const characterInfo = useInject(CharacterInfo);
  const invitationApi = useClient<InvitationApi>();
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

      <Flex flex={1} p="lg">
        <Stack w="100%" maw={800}>
          <Group gap="sm" align="center" justify="space-between">
            <Group gap="sm" align="center">
              <IconUsers size={24} />
              <Title order={2}>Players</Title>
              <Badge variant="light" color="blue">
                {players.length + pendingInvitations.length}{" "}
                {players.length + pendingInvitations.length === 1
                  ? "player"
                  : "players"}
              </Badge>
            </Group>
            {project && project.createdBy === auth.user?.id && (
              <Button leftSection={<IconPlus size={16} />} onClick={open}>
                Add Player
              </Button>
            )}
          </Group>

          <Text c="dimmed" size="sm">
            All adventurers participating in this project
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
                  bg={"var(--alepha-elevated)"}
                  key={player.id}
                  shadow="sm"
                  padding="lg"
                  radius="md"
                  withBorder
                >
                  <Group gap="lg" align="flex-start">
                    <Avatar
                      src={player.user.picture}
                      size={60}
                      radius="md"
                      style={{
                        border: player.owner
                          ? "2px solid var(--mantine-color-yellow-6)"
                          : "2px solid var(--mantine-color-gray-4)",
                      }}
                    >
                      <IconUser size={30} />
                    </Avatar>

                    <Stack gap="xs" flex={1}>
                      <Group gap="sm" align="center">
                        <Text fw={500} size="lg">
                          {player.user.name || "Anonymous User"}
                        </Text>
                        {player.owner && (
                          <Badge
                            variant="filled"
                            color="yellow"
                            leftSection={<IconCrown size={12} />}
                          >
                            Owner
                          </Badge>
                        )}
                        <Badge variant="light" color="blue">
                          Level {level}
                        </Badge>
                      </Group>

                      <Text size="sm" c="dimmed">
                        {player.user.email}
                      </Text>

                      <Group gap="lg">
                        <Group gap="xs">
                          <IconStar size={16} />
                          <Text size="sm" fw={500}>
                            {player.xp.toLocaleString()} XP
                          </Text>
                        </Group>
                        <Group gap="xs">
                          <IconTrophy size={16} />
                          <Text size="sm" fw={500} c="yellow.6">
                            {gold}g {silver}s
                          </Text>
                        </Group>
                      </Group>

                      <Text size="xs" c="dimmed">
                        Joined: {l(player.createdAt)}
                      </Text>
                    </Stack>
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
                style={{ opacity: 0.7 }}
              >
                <Group gap="lg" align="flex-start">
                  <Avatar
                    size={60}
                    radius="md"
                    style={{
                      border: "2px dashed var(--mantine-color-gray-5)",
                    }}
                  >
                    <IconMail size={30} />
                  </Avatar>

                  <Stack gap="xs" flex={1}>
                    <Group gap="sm" align="center">
                      <Text fw={500} size="lg" c="dimmed">
                        {invitation.invitedEmail}
                      </Text>
                      <Badge variant="light" color="orange">
                        Invited
                      </Badge>
                    </Group>

                    <Text size="sm" c="dimmed">
                      Invitation sent
                    </Text>

                    <Text size="xs" c="dimmed">
                      Invited: {l(invitation.createdAt)}
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
