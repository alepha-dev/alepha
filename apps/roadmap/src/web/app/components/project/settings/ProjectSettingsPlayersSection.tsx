import { ActionButton, Flex, Text, useToast } from "@alepha/ui";
import { Avatar, Badge, Card, Modal, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCircleFilled,
  IconCrown,
  IconMail,
  IconPlus,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { Localize, useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { Character } from "@/api/entities/characters.ts";
import type { InvitationEntity } from "@/api/entities/invitations.ts";
import type { Project } from "@/api/entities/projects.ts";
import type { User } from "@/api/entities/users.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsPlayersSectionProps {
  project: Project;
  players: Array<Character & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
}

const ProjectSettingsPlayersSection = (
  props: ProjectSettingsPlayersSectionProps,
) => {
  const { project, players, pendingInvitations = [] } = props;
  const characterInfo = useInject(CharacterInfo);
  const invitationApi = useClient<InvitationController>();
  const auth = useAuth();
  const toast = useToast();
  const { l } = useI18n();
  const { tr } = useI18n<I18n, "en">();

  const [opened, { open, close }] = useDisclosure(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleInvite = async () => {
    if (!email.trim()) {
      toast.danger({ message: "Please enter an email address" });
      return;
    }

    setLoading(true);
    try {
      await invitationApi.createInvitation({
        body: {
          email: email.trim(),
          resourceType: "project",
          resourceId: String(project.id),
        },
      });

      toast.success({ message: `Invitation sent to ${email}` });

      setEmail("");
      close();
      window.location.reload();
    } catch (error: any) {
      toast.danger({
        message: error.message || "Failed to send invitation",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={close}
        title={tr("project.settings.players.invite.title")}
      >
        <Flex direction="column" gap="md">
          <Text size="sm" c="dimmed">
            {tr("project.settings.players.invite.description", {
              args: [project.title],
            })}
          </Text>
          <TextInput
            label={tr("project.settings.players.invite.email")}
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
          <Flex gap="sm" justify="flex-end">
            <ActionButton variant="light" onClick={close}>
              {tr("project.settings.players.invite.cancel")}
            </ActionButton>
            <ActionButton onClick={handleInvite} loading={loading}>
              {tr("project.settings.players.invite.submit")}
            </ActionButton>
          </Flex>
        </Flex>
      </Modal>

      <Flex direction="column" gap={"xs"}>
        <Flex justify="space-between" align="center">
          <Flex gap="sm" align="center">
            <Text>{tr("project.settings.players.title")}</Text>
            <Badge variant="light" size="sm">
              {players.length + pendingInvitations.length}
            </Badge>
          </Flex>
          {project.createdBy === auth.user?.id && (
            <ActionButton
              variant="light"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={open}
            >
              {tr("project.settings.players.invite.action")}
            </ActionButton>
          )}
        </Flex>

        <Flex direction="column" gap="sm">
          {players.map((player) => {
            const level = characterInfo.getLevelByXp(player.xp);
            const gold = characterInfo.getGold(player.balance);
            const silver = characterInfo.getSilver(player.balance);

            return (
              <Card
                withBorder
                key={player.id}
                radius={0}
                className={"shadow"}
                bg={theme.colors.card}
                p={"sm"}
              >
                <Flex gap="lg" align="center">
                  <Avatar
                    src={
                      player.user.picture
                        ? `/api/files/${player.user.picture}`
                        : undefined
                    }
                    size={40}
                    radius="md"
                  >
                    <IconUser size={20} />
                  </Avatar>

                  <Flex direction="column" flex={1}>
                    <Flex gap="sm" align="center">
                      <Text fw={500} size="sm">
                        {player.user.username}
                      </Text>
                      {player.owner && (
                        <Badge
                          variant="light"
                          size="xs"
                          leftSection={<IconCrown size={10} />}
                        >
                          Owner
                        </Badge>
                      )}
                    </Flex>
                    <Text size="xs" c="dimmed">
                      {player.user.email}
                    </Text>
                  </Flex>

                  <Flex align={"center"} gap="lg">
                    <Flex direction="column" gap={0}>
                      <Text size="xs" c="dimmed">
                        Lv. {level}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {l(player.xp)} XP
                      </Text>
                    </Flex>
                    <Flex gap={2}>
                      {gold > 0 && (
                        <>
                          <Text size="xs" fw={500}>
                            {gold}
                          </Text>
                          <IconCircleFilled
                            size={8}
                            color="var(--color-gold)"
                          />
                        </>
                      )}
                      {silver > 0 && (
                        <>
                          <Text size="xs" fw={500}>
                            {silver}
                          </Text>
                          <IconCircleFilled
                            size={8}
                            color="var(--color-silver)"
                          />
                        </>
                      )}
                    </Flex>
                  </Flex>

                  <Text size="xs" c="dimmed">
                    <Localize value={player.createdAt} date="fromNow" />
                  </Text>
                </Flex>
              </Card>
            );
          })}

          {pendingInvitations.map((invitation) => (
            <Card
              key={invitation.id}
              radius={0}
              withBorder
              className={"shadow"}
              bg={theme.colors.card}
              p={"sm"}
              style={{ opacity: 0.6 }}
            >
              <Flex gap="lg" align="center">
                <Avatar size={40} radius="md" color="gray">
                  <IconMail size={20} />
                </Avatar>

                <Flex direction="column" flex={1}>
                  <Flex gap="sm" align="center">
                    <Text fw={500} size="sm">
                      {invitation.email}
                    </Text>
                    <Badge variant="light" size="xs">
                      Pending
                    </Badge>
                  </Flex>
                  <Text size="xs" c="dimmed">
                    <Localize value={invitation.createdAt} date="fromNow" />
                  </Text>
                </Flex>
              </Flex>
            </Card>
          ))}

          {players.length === 0 && pendingInvitations.length === 0 && (
            <Card
              radius={0}
              withBorder
              className={"shadow"}
              bg={theme.colors.card}
              p={"md"}
            >
              <Flex align="center" justify="center" direction="column" gap="sm">
                <IconUsers size={32} opacity={0.5} />
                <Text c="dimmed" size="sm" ta="center">
                  {tr("project.settings.players.empty")}
                </Text>
              </Flex>
            </Card>
          )}
        </Flex>
      </Flex>
    </>
  );
};

export default ProjectSettingsPlayersSection;
