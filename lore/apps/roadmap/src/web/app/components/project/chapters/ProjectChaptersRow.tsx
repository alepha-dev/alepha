import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card } from "@mantine/core";
import { IconBook2, IconTrash } from "@tabler/icons-react";
import { useI18n } from "alepha/react/i18n";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { ChapterWithCount } from "./ProjectChapters.tsx";

export interface ProjectChaptersRowProps {
  chapter: ChapterWithCount;
  onDelete: (id: number) => void;
  onViewChangelog: (id: number) => void;
}

const ProjectChaptersRow = (props: ProjectChaptersRowProps) => {
  const { chapter, onDelete, onViewChangelog } = props;
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();
  const isActive = !chapter.closedAt;

  return (
    <Card
      withBorder
      radius="md"
      bg={theme.colors.card}
      className="shadow"
      p="sm"
    >
      <Flex align="center" justify="space-between" gap="sm">
        <Flex align="center" gap="sm" flex={1}>
          <Badge
            size="lg"
            variant={isActive ? "filled" : "light"}
            color={isActive ? "green" : "gray"}
          >
            #{chapter.number}
          </Badge>
          <Flex direction="column" gap={0} flex={1}>
            <Text size="sm" fw={600}>
              {chapter.title}
            </Text>
            <Flex gap="xs">
              <Text size="xs" c="dimmed">
                {tr("chapter.list.quests", {
                  args: [String(chapter.questCount)],
                })}
              </Text>
              {chapter.closedAt && (
                <Text size="xs" c="dimmed">
                  {tr("chapter.list.closed", {
                    args: [String(i18n.l(chapter.closedAt, { date: "ll" }))],
                  })}
                </Text>
              )}
            </Flex>
          </Flex>
        </Flex>
        <Flex gap="xs">
          <ActionButton
            variant="minimal"
            size="sm"
            leftSection={<IconBook2 size={theme.icon.size.sm} />}
            onClick={() => onViewChangelog(chapter.id)}
          >
            {tr("chapter.changelog")}
          </ActionButton>
          {chapter.questCount === 0 && (
            <ActionButton
              variant="light"
              color="red"
              size="sm"
              leftSection={<IconTrash size={theme.icon.size.sm} />}
              onClick={() => onDelete(chapter.id)}
            >
              {tr("chapter.delete")}
            </ActionButton>
          )}
        </Flex>
      </Flex>
    </Card>
  );
};

export default ProjectChaptersRow;
