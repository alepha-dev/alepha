import { Flex, Text } from "@alepha/mantine";
import { Card } from "@mantine/core";
import { IconCircleFilled, IconMoneybag } from "@tabler/icons-react";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { currentProjectCharacterAtom } from "@/web/app/atoms/currentProjectCharacterAtom.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export type ProjectSettingsCharacterSectionProps = {};

const ProjectSettingsCharacterSection = (
  props: ProjectSettingsCharacterSectionProps,
) => {
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

export default ProjectSettingsCharacterSection;
