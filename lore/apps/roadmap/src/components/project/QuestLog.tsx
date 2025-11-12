import { useStore } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { ActionIcon, Card, Flex, Menu, Text, TextInput } from "@mantine/core";
import {
  IconBook2,
  IconDots,
  IconExclamationMark,
  IconSearch,
  IconSelector,
  IconSortAZ,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import TaskList from "./task/TaskList.jsx";

const QuestLog = () => {
  const [tasks = []] = useStore("current_assigned_tasks");
  const { tr } = useI18n<I18n, "en">();
  const [searchValue, setSearchValue] = useState<string>("");

  // Client-side filtering of tasks based on search
  const filteredTasks = useMemo(() => {
    if (!searchValue.trim()) {
      return tasks;
    }

    return tasks.filter((task) =>
      task.title.toLowerCase().includes(searchValue.toLowerCase().trim()),
    );
  }, [tasks, searchValue]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(event.currentTarget.value);
  };

  const handleClearSearch = () => {
    setSearchValue("");
  };
  return (
    <Card
      flex={1}
      h={"100%"}
      p={0}
      radius={"md"}
      withBorder
      className={"shadow-2"}
      bg={theme.colors.card}
      w={"100%"}
      style={{
        position: "relative",
      }}
    >
      <Flex gap={"xs"} p={"xs"}>
        <Flex align="center" justify="center" px={"xs"} visibleFrom={"xl"}>
          <IconBook2 size={theme.icon.size.xl} />
        </Flex>
        <Card
          radius={"md"}
          className={"shadow"}
          withBorder
          bg={theme.colors.panel}
          flex={1}
          p={0}
        >
          <Flex flex={1} px={"xs"} align={"center"}>
            <Flex px={2} gap={"xs"} align="center" justify="center">
              <Text size="xs">{tr("quest-log.quests")}</Text>
              <Card
                radius={"md"}
                withBorder
                p={0}
                px={6}
                style={{ padding: "0 4px" }}
              >
                <Text size="xs">{filteredTasks.length}/25</Text>
              </Card>
            </Flex>
            <Flex flex={1} />
            <Flex px={1}>
              <ActionIcon disabled variant={"subtle"}>
                <IconSelector size={theme.icon.size.md} />
              </ActionIcon>
              <Menu
                withArrow
                arrowSize={12}
                trigger="hover"
                position="bottom-start"
              >
                <Menu.Target>
                  <ActionIcon disabled variant={"subtle"}>
                    <IconDots size={theme.icon.size.md} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Sort by</Menu.Label>
                  <Menu.Item leftSection={<IconSortAZ />}>Name</Menu.Item>
                  <Menu.Item leftSection={<IconExclamationMark />}>
                    Priority
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Flex>
          </Flex>
        </Card>
      </Flex>
      <Flex px={"xs"}>
        <TextInput
          size={"xs"}
          radius={"xl"}
          disabled={tasks.length === 0}
          placeholder={tr("quest-log.search")}
          flex={1}
          value={searchValue}
          onChange={handleSearchChange}
          leftSection={<IconSearch size={theme.icon.size.xs} />}
          rightSection={
            searchValue && (
              <ActionIcon
                size="xs"
                variant="subtle"
                onClick={handleClearSearch}
                color="gray"
              >
                <IconX size={theme.icon.size.xs} />
              </ActionIcon>
            )
          }
        />
      </Flex>
      <Flex
        direction={"column"}
        gap={"xs"}
        className={"overflow-auto"}
        p={"xs"}
      >
        <TaskList tasks={filteredTasks} />
      </Flex>
    </Card>
  );
};

export default QuestLog;
