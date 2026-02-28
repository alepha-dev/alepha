import { Flex, Text } from "@alepha/ui";
import { Badge, Card } from "@mantine/core";
import { IconCircleFilled, IconCrown } from "@tabler/icons-react";
import { Localize, useI18n } from "alepha/react/i18n";
import type { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { MyCharactersCharacter } from "./MyCharacters.tsx";
import MyCharactersXPBar from "./MyCharactersXPBar.tsx";

export interface MyCharactersCardProps {
  character: MyCharactersCharacter;
  characterInfo: CharacterInfo;
}

const MyCharactersCard = (props: MyCharactersCardProps) => {
  const { character, characterInfo } = props;
  const { l } = useI18n();
  const level = characterInfo.getLevelByXp(character.xp);
  const gold = characterInfo.getGold(character.balance);
  const silver = characterInfo.getSilver(character.balance);

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Flex direction="column" gap="md">
        <Flex justify="space-between" align="flex-start">
          <Flex direction="column" gap="xs">
            <Flex gap="sm">
              <Text fw={500} size="lg">
                {character.projectTitle}
              </Text>
              {character.owner && (
                <Badge variant="light" leftSection={<IconCrown size={12} />}>
                  Owner
                </Badge>
              )}
            </Flex>
            <Text size="sm" c="dimmed">
              Created <Localize value={character.createdAt} date="fromNow" />
            </Text>
          </Flex>

          <Flex gap="xl">
            <Flex direction="column" gap={2}>
              <Text size="xs" c="dimmed" fw={500}>
                Level
              </Text>
              <Text size="sm" fw={500}>
                {level}
              </Text>
            </Flex>
            <Flex direction="column" gap={2}>
              <Text size="xs" c="dimmed" fw={500}>
                Balance
              </Text>
              <Flex gap={2}>
                {gold > 0 && (
                  <>
                    <Text size="sm" fw={500}>
                      {gold}
                    </Text>
                    <IconCircleFilled size={10} color="var(--color-gold)" />
                  </>
                )}
                {silver > 0 && (
                  <>
                    <Text size="sm" fw={500}>
                      {silver}
                    </Text>
                    <IconCircleFilled size={10} color="var(--color-silver)" />
                  </>
                )}
                {gold === 0 && silver === 0 && (
                  <Text size="sm" fw={500}>
                    0
                  </Text>
                )}
              </Flex>
            </Flex>
            <Flex direction="column" gap={2}>
              <Text size="xs" c="dimmed" fw={500}>
                Total XP
              </Text>
              <Text size="sm" fw={500}>
                {l(character.xp)}
              </Text>
            </Flex>
          </Flex>
        </Flex>

        <MyCharactersXPBar
          character={character}
          characterInfo={characterInfo}
        />
      </Flex>
    </Card>
  );
};

export default MyCharactersCard;
