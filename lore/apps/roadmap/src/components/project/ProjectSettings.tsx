import { useAlepha, useClient, useRouter, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import {
  Button,
  Card,
  Flex,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type { ProjectApi } from "../../api/ProjectApi.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../ui/Action.jsx";
import ProjectUpdate from "./ProjectUpdate.jsx";

const ProjectSettings = () => {
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const projectApi = useClient<ProjectApi>();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  const openDeleteModal = () =>
    new Promise<boolean>((resolve) => {
      modals.open({
        id: "delete-campaign-modal",
        title: "Delete Campaign",
        centered: true,
        children: <ConfirmationModal resolve={resolve} project={project} />,
        withCloseButton: false,
        closeOnClickOutside: false,
        closeOnEscape: false,
        onClose: () => resolve(false),
      });
    });

  return (
    <Stack flex={1} p={"md"}>
      <Stack gap={"xs"}>
        <Text>{tr("project.settings.general.title")}</Text>
        <ProjectUpdate project={project} />
      </Stack>
      <Stack gap={"xs"}>
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
            <Stack gap={0}>
              <Text size={"sm"}>{tr("project.settings.actions.delete")}</Text>
              <Text size="xs" c={"dimmed"}>
                {tr("project.settings.actions.delete.helper")}
              </Text>
            </Stack>
            <Flex justify={"end"} align={"center"}>
              <Action
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

                      router.go("home");
                    });
                }}
              >
                {tr("project.settings.actions.delete")}
              </Action>
            </Flex>
          </SimpleGrid>
        </Card>
      </Stack>
    </Stack>
  );
};

export default ProjectSettings;

const ConfirmationModal = ({
  project,
  resolve,
}: {
  project: { title: string };
  resolve: (value: boolean) => void;
}) => {
  const [inputValue, setInputValue] = useState("");
  const isValid = inputValue === project.title;

  return (
    <Stack gap="md">
      <Text size="sm">
        This action cannot be undone. This will permanently delete the project
        and all associated data.
      </Text>
      <Text size="sm">
        Please type <strong>{project.title}</strong> to confirm:
      </Text>
      <TextInput
        value={inputValue}
        onChange={(event) => setInputValue(event.currentTarget.value)}
        placeholder={project.title}
        data-autofocus
      />
      <Group justify="flex-end" gap="sm">
        <Button
          variant="default"
          onClick={() => {
            modals.closeAll();
            resolve(false);
          }}
        >
          Cancel
        </Button>
        <Button
          color="red"
          disabled={!isValid}
          onClick={() => {
            modals.closeAll();
            resolve(true);
          }}
        >
          Delete Campaign
        </Button>
      </Group>
    </Stack>
  );
};
