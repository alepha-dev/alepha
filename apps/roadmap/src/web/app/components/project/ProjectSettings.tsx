import { ActionButton, Flex, Text, useToast } from "@alepha/ui";
import {
  Avatar,
  Badge,
  Card,
  Container,
  Modal,
  SimpleGrid,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import {
  IconCircleFilled,
  IconCrown,
  IconDownload,
  IconMail,
  IconMoneybag,
  IconPlus,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { Localize, useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { InvitationController } from "../../../../api/controllers/InvitationController.ts";
import type { ProjectController } from "../../../../api/controllers/ProjectController.ts";
import type { Character } from "../../../../api/entities/characters.ts";
import type { Invitation } from "../../../../api/entities/invitations.ts";
import type { Project } from "../../../../api/entities/projects.ts";
import type { User } from "../../../../api/entities/users.ts";
import { CharacterInfo } from "../../../../api/services/CharacterInfo.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "../../atoms/currentProjectCharacterAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import ProjectUpdate from "./ProjectUpdate.tsx";

export interface ProjectSettingsProps {
  project: Project;
  players: Array<Character & { user: User }>;
  pendingInvitations: Array<Invitation>;
}

const ProjectSettings = (props: ProjectSettingsProps) => {
  const { players, pendingInvitations } = props;
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const projectApi = useClient<ProjectController>();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  const openDeleteModal = () =>
    new Promise<boolean>((resolve) => {
      modals.open({
        id: "delete-campaign-modal",
        title: tr("project.settings.delete.modal.title"),
        centered: true,
        children: <ConfirmationModal resolve={resolve} project={project} />,
        withCloseButton: false,
        closeOnClickOutside: false,
        closeOnEscape: false,
        onClose: () => resolve(false),
      });
    });

  return (
    <Container size="md" w="100%" px={{ base: 0, md: "xs" }}>
      <Flex direction="column" flex={1} p={"md"} gap={"lg"}>
        {/* General */}
        <Flex direction="column" gap={"xs"}>
          <Text>{tr("project.settings.general.title")}</Text>
          <ProjectUpdate project={project} />
        </Flex>

        {/* Character */}
        <CharacterSection />

        {/* Players */}
        <PlayersSection
          project={project}
          players={players}
          pendingInvitations={pendingInvitations}
        />

        {/* Backup */}
        <Flex direction="column" gap={"xs"}>
          <Text>{tr("project.settings.backup.title")}</Text>
          <Card
            radius={0}
            withBorder
            className={"shadow"}
            bg={theme.colors.card}
            p={"sm"}
          >
            <SimpleGrid
              cols={{
                base: 1,
                xs: 2,
              }}
            >
              <Flex direction="column" gap={0}>
                <Text size={"sm"}>{tr("project.settings.actions.backup")}</Text>
                <Text size="xs" c={"dimmed"}>
                  {tr("project.settings.actions.backup.helper")}
                </Text>
              </Flex>
              <Flex justify={"end"} align={"center"}>
                <ActionButton
                  flex={{
                    base: 1,
                    xs: "unset",
                  }}
                  leftSection={<IconDownload />}
                  onClick={() => {
                    window.open(`/api/projects/${project.id}/backup`, "_blank");
                  }}
                >
                  {tr("project.settings.actions.backup")}
                </ActionButton>
              </Flex>
            </SimpleGrid>
          </Card>
        </Flex>

        {/* Danger Zone */}
        <Flex direction="column" gap={"xs"}>
          <Text>{tr("project.settings.danger.title")}</Text>
          <Card
            radius={0}
            withBorder
            className={"shadow"}
            bg={theme.colors.card}
            p={"sm"}
          >
            <SimpleGrid
              cols={{
                base: 1,
                xs: 2,
              }}
            >
              <Flex direction="column" gap={0}>
                <Text size={"sm"}>{tr("project.settings.actions.delete")}</Text>
                <Text size="xs" c={"dimmed"}>
                  {tr("project.settings.actions.delete.helper")}
                </Text>
              </Flex>
              <Flex justify={"end"} align={"center"}>
                <ActionButton
                  flex={{
                    base: 1,
                    xs: "unset",
                  }}
                  color={"red"}
                  onClick={async () => {
                    const confirmed = await openDeleteModal();
                    if (!confirmed) {
                      return;
                    }

                    projectApi
                      .deleteProjectById({
                        params: { id: project.id },
                      })
                      .then(() => {
                        alepha.store.set(
                          userProjectsAtom,
                          (alepha.store.get(userProjectsAtom) ?? []).filter(
                            (p) => p.id !== project.id,
                          ),
                        );

                        router.push("home");
                      });
                  }}
                >
                  {tr("project.settings.actions.delete")}
                </ActionButton>
              </Flex>
            </SimpleGrid>
          </Card>
        </Flex>
      </Flex>
    </Container>
  );
};

export default ProjectSettings;

const CharacterSection = () => {
  const [character] = useStore(currentProjectCharacterAtom);
  const helper = useInject(CharacterInfo);
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();

  if (!character) {
    return null;
  }

  const gold = helper.getGold(character.balance);
  const silver = helper.getSilver(character.balance);
  const level = helper.getLevelByXp(character.xp);
  const nextXp = helper.getNextXpForLevel(character.xp);

  return (
    <Flex direction="column" gap={"xs"}>
      <Text>{tr("project.settings.character.title")}</Text>
      <Card
        radius={0}
        withBorder
        className={"shadow"}
        bg={theme.colors.card}
        p={"sm"}
      >
        <Flex gap={"md"} align="center">
          <Flex
            direction="column"
            gap={0}
            flex={1}
            align="center"
            justify="center"
          >
            <Text size="sm">
              {tr("project.settings.character.level", {
                args: [String(level)],
              })}
            </Text>
            <Text size="xs" c={"dimmed"}>
              {tr("project.settings.character.nextLevel", {
                args: [String(i18n.l(nextXp))],
              })}
            </Text>
          </Flex>
          <Flex
            direction="column"
            gap={0}
            flex={1}
            align="center"
            justify="center"
          >
            <Flex gap={"xs"} align="center" justify="center">
              <IconMoneybag size={theme.icon.size.md} />
              <Flex gap={"xs"} align={"center"}>
                <Flex align={"center"} gap={2}>
                  <Text size={"sm"}>{gold}</Text>
                  <IconCircleFilled
                    color={"var(--color-gold)"}
                    size={theme.icon.size.xs}
                  />
                </Flex>
                <Flex align={"center"} gap={2}>
                  <Text size={"sm"}>{silver}</Text>
                  <IconCircleFilled
                    color={"var(--color-silver)"}
                    size={theme.icon.size.xs}
                  />
                </Flex>
              </Flex>
            </Flex>
            <Text size="xs" c={"dimmed"}>
              {tr("project.settings.character.balance")}
            </Text>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
};

const PlayersSection = ({
  project,
  players,
  pendingInvitations = [],
}: {
  project: Project;
  players: Array<Character & { user: User }>;
  pendingInvitations: Array<Invitation>;
}) => {
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
          projectId: project.id,
          invitedEmail: email.trim(),
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
                      {invitation.invitedEmail}
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

const ConfirmationModal = ({
  project,
  resolve,
}: {
  project: { title: string };
  resolve: (value: boolean) => void;
}) => {
  const [inputValue, setInputValue] = useState("");
  const { tr } = useI18n<I18n, "en">();
  const isValid = inputValue === project.title;

  return (
    <Flex direction="column" gap="md">
      <Text size="sm">{tr("project.settings.delete.modal.description")}</Text>
      <Text size="sm">
        {tr("project.settings.delete.modal.confirm", {
          args: [project.title],
        })}
      </Text>
      <TextInput
        value={inputValue}
        onChange={(event) => setInputValue(event.currentTarget.value)}
        placeholder={project.title}
        data-autofocus
      />
      <Flex justify="flex-end" gap="sm">
        <ActionButton
          variant="default"
          onClick={() => {
            modals.closeAll();
            resolve(false);
          }}
        >
          {tr("project.settings.delete.modal.cancel")}
        </ActionButton>
        <ActionButton
          color="red"
          disabled={!isValid}
          onClick={() => {
            modals.closeAll();
            resolve(true);
          }}
        >
          {tr("project.settings.delete.modal.submit")}
        </ActionButton>
      </Flex>
    </Flex>
  );
};
