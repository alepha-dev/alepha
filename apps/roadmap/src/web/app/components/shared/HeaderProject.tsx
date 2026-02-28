import { ActionButton, Flex } from "@alepha/ui";
import { Center, Menu, SegmentedControl } from "@mantine/core";

import {
  IconColumns,
  IconPlus,
  IconSquare,
  IconSquareCheck,
  IconTable,
} from "@tabler/icons-react";
import { useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { kanbanProjectAtom } from "../../atoms/kanbanProjectAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";

const HeaderProject = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [kanban] = useStore(kanbanProjectAtom);
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const { params } = routerState;
  const [projects = []] = useStore(userProjectsAtom);
  const auth = useAuth();

  const activeProject = project ?? kanban?.project;
  if (!activeProject) {
    return null;
  }

  const isKanban = routerState.name === "kanban";
  const projectId = activeProject.id;

  const menuItem = (id: number, label: string) => {
    return (
      <Menu.Item
        key={id}
        leftSection={
          params.projectId === String(id) ? (
            <IconSquareCheck size={16} />
          ) : (
            <IconSquare size={16} />
          )
        }
        onClick={() => router.push(`/p/${id}`)}
      >
        {label}
      </Menu.Item>
    );
  };

  return (
    <Flex visibleFrom={"sm"} gap={"xs"} align="center" justify="center">
      <Menu withArrow arrowSize={12} trigger="hover" position="bottom">
        <Menu.Target>
          <ActionButton tt={"capitalize"} variant={"minimal"}>
            {activeProject.title}
          </ActionButton>
        </Menu.Target>
        <Menu.Dropdown>
          {projects.map((p) => menuItem(p.id, p.title))}
          {!!projects.length && <Menu.Divider />}
          <Menu.Item
            leftSection={<IconPlus size={16} />}
            component="a"
            {...router.anchor("projectCreate")}
          >
            {tr("home.create-campaign")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      {auth.user && projects.some((p) => p.id === projectId) && (
        <Flex>
          <SegmentedControl
            size={"lg"}
            onChange={(value) =>
              setTimeout(() =>
                value === "roadmap"
                  ? router.push(`/p/${projectId}`)
                  : router.push(`/k/${projectId}`),
              )
            }
            value={isKanban ? "kanban" : "roadmap"}
            data={[
              {
                label: (
                  <Center>
                    <IconTable size={theme.icon.size.sm} />
                  </Center>
                ),
                value: "roadmap",
              },
              {
                label: (
                  <Center>
                    <IconColumns size={theme.icon.size.sm} />
                  </Center>
                ),
                value: "kanban",
              },
            ]}
          ></SegmentedControl>
        </Flex>
      )}
    </Flex>
  );
};

export default HeaderProject;
