import { useClient } from "@alepha/react";
import { Localize, useI18n } from "@alepha/react/i18n";
import { Flex } from "@alepha/ui";
import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Paper,
  SimpleGrid,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconChecklist,
  IconClock,
  IconRocket,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import type { TaskController } from "../../api/controllers/TaskController.ts";
import type { TaskEntity } from "../../api/entities/taskEntity.ts";
import type { AppI18n } from "../AppI18n.ts";

type Props = {
  tasks: TaskEntity[];
};

const Home = (props: Props) => {
  const client = useClient<TaskController>();
  const { tr } = useI18n<AppI18n, "en">();
  const [tasks, setTasks] = useState(props.tasks);
  const [showWelcome, setShowWelcome] = useState(true);

  const onClickDelete = (taskId: string) => async () => {
    const updatedTasks = await client.deleteTask({
      params: { task: taskId },
    });
    setTasks(updatedTasks);
  };

  return (
    <Flex direction="column" gap="lg">
      {showWelcome && (
        <Alert
          icon={<IconRocket size={24} />}
          title={tr("welcome.title")}
          color="blue"
          withCloseButton
          onClose={() => setShowWelcome(false)}
        >
          <Text size="sm" fw={500} mb="xs">
            {tr("welcome.subtitle")}
          </Text>
          <Text size="sm" c="dimmed" mb="sm">
            {tr("welcome.message")}
          </Text>
          <Text size="sm" fw={600} c="blue">
            {tr("welcome.cta")}
          </Text>
        </Alert>
      )}

      <Flex justify="space-between" align="center">
        <Flex align="center" gap="sm">
          <ThemeIcon size="lg" variant="light">
            <IconChecklist size={20} />
          </ThemeIcon>
          <Title order={2}>{tr("home.tasksTitle")}</Title>
        </Flex>
        <Badge size="lg" variant="light">
          {tasks.length} {tr("home.taskCount")}
        </Badge>
      </Flex>

      {tasks.length === 0 ? (
        <Paper withBorder p="xl" ta="center">
          <Flex direction="column" align="center" gap="md">
            <ThemeIcon size={60} variant="light" color="gray">
              <IconChecklist size={30} />
            </ThemeIcon>
            <Text c="dimmed" size="lg">
              {tr("home.noTasks")}
            </Text>
            <Text c="dimmed" size="sm">
              {tr("home.noTasksHint")}
            </Text>
          </Flex>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {tasks.map((task) => (
            <Card key={task.id} withBorder shadow="sm" padding="md">
              <Flex direction="column" gap="sm" h="100%">
                <Flex justify="space-between" align="flex-start">
                  <Text fw={600} size="lg" lineClamp={2}>
                    {task.name}
                  </Text>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={onClickDelete(task.id)}
                    aria-label={tr("home.deleteButton")}
                  >
                    <IconTrash size={18} />
                  </ActionIcon>
                </Flex>

                <Flex align="center" gap="xs" mt="auto">
                  <IconClock size={14} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">
                    <Localize value={task.createdAt} date="LLL" />
                  </Text>
                </Flex>
              </Flex>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Flex>
  );
};

export default Home;
