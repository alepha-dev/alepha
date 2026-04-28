import { Flex, Text } from "@alepha/mantine";
import { Badge, Progress } from "@mantine/core";
import { IconCoin, IconCrown, IconSwords } from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { Localize, useI18n } from "alepha/react/i18n";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";

export interface MyCharactersCharacter {
  id: number;
  projectId: number;
  projectTitle: string;
  xp: number;
  balance: number;
  owner?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MyCharactersProps {
  characters: Array<MyCharactersCharacter>;
}

const MyCharacters = (props: MyCharactersProps) => {
  const { characters } = props;
  const characterInfo = useInject(CharacterInfo);
  const { l } = useI18n();

  if (!characters || characters.length === 0) {
    return (
      <Flex
        flex={1}
        align="center"
        justify="center"
        direction="column"
        gap="sm"
        py="xl"
      >
        <IconSwords size={40} opacity={0.3} />
        <Text c="dimmed" ta="center">
          No characters yet. Join a campaign to begin your adventure.
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="lg" flex={1} py="md">
      <Flex align="center" gap="sm">
        <IconSwords size={20} />
        <Text size="lg" fw={700}>
          My Characters
        </Text>
        <Badge variant="light" size="sm">
          {characters.length}
        </Badge>
      </Flex>

      <Flex direction="column" gap="sm">
        {characters.map((character) => {
          const level = characterInfo.getLevelByXp(character.xp);
          const maxXp = characterInfo.getMaxXpForLevel(level);
          const currentXp = characterInfo.getCurrentXpForLevel(
            level,
            character.xp,
          );
          const percentage = Math.floor((currentXp * 100) / maxXp);
          const gold = characterInfo.getGold(character.balance);
          const silver = characterInfo.getSilver(character.balance);

          return (
            <Flex
              key={character.id}
              direction="column"
              gap="sm"
              p="md"
              bg="var(--alepha-elevated)"
              style={{
                borderRadius: "var(--mantine-radius-md)",
                border: "1px solid var(--alepha-border)",
              }}
            >
              <Flex justify="space-between" align="center">
                <Flex align="center" gap="sm">
                  <Text fw={600}>{character.projectTitle}</Text>
                  {character.owner && (
                    <Badge
                      variant="light"
                      size="xs"
                      color="orange"
                      leftSection={<IconCrown size={10} />}
                    >
                      Owner
                    </Badge>
                  )}
                </Flex>

                <Flex gap="lg" align="center">
                  <Flex direction="column" align="center" gap={0}>
                    <Text size="xs" c="dimmed">
                      Level
                    </Text>
                    <Text size="sm" fw={700}>
                      {level}
                    </Text>
                  </Flex>
                  <Flex direction="column" align="center" gap={0}>
                    <Text size="xs" c="dimmed">
                      Treasury
                    </Text>
                    <Flex align="center" gap={4}>
                      <IconCoin
                        size={12}
                        color="var(--mantine-color-yellow-5)"
                      />
                      <Text size="sm" fw={600} c="yellow.5">
                        {gold}
                      </Text>
                      {silver > 0 && (
                        <Text size="xs" c="dimmed">
                          {silver}s
                        </Text>
                      )}
                    </Flex>
                  </Flex>
                  <Flex direction="column" align="center" gap={0}>
                    <Text size="xs" c="dimmed">
                      XP
                    </Text>
                    <Text size="sm" fw={600}>
                      {l(character.xp)}
                    </Text>
                  </Flex>
                </Flex>
              </Flex>

              {/* XP Progress */}
              <Flex direction="column" gap={4}>
                <Progress
                  value={percentage}
                  size="xs"
                  radius="xl"
                  color="blue"
                />
                <Flex justify="space-between">
                  <Text size="xs" c="dimmed">
                    {l(currentXp)} / {l(maxXp)} XP
                  </Text>
                  <Text size="xs" c="dimmed">
                    {percentage}% to Lv. {level + 1}
                  </Text>
                </Flex>
              </Flex>

              <Text size="xs" c="dimmed">
                Joined <Localize value={character.createdAt} date="fromNow" />
              </Text>
            </Flex>
          );
        })}
      </Flex>
    </Flex>
  );
};

export default MyCharacters;
