import { ActionButton, Flex, Text } from "@alepha/ui";
import { Card, Container, SimpleGrid } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconDownload } from "@tabler/icons-react";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { Character } from "@/api/entities/characters.ts";
import type { Invitation } from "@/api/entities/invitations.ts";
import type { Project } from "@/api/entities/projects.ts";
import type { User } from "@/api/entities/users.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import ProjectUpdate from "../ProjectUpdate.tsx";
import ProjectSettingsCharacterSection from "./ProjectSettingsCharacterSection.tsx";
import ProjectSettingsConfirmationModal from "./ProjectSettingsConfirmationModal.tsx";
import ProjectSettingsPlayersSection from "./ProjectSettingsPlayersSection.tsx";

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
        children: (
          <ProjectSettingsConfirmationModal
            resolve={resolve}
            project={project}
          />
        ),
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
        <ProjectSettingsCharacterSection />

        {/* Players */}
        <ProjectSettingsPlayersSection
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
