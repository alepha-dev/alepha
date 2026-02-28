import { Flex, Text } from "@alepha/ui";
import { Badge, Card, Progress, Title } from "@mantine/core";
import { IconCircleFilled, IconCrown } from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { Localize, useI18n } from "alepha/react/i18n";
import { CharacterInfo } from "../../../../api/services/CharacterInfo.ts";

export interface MyCharactersProps {
  characters: Array<{
    id: number;
    projectId: number;
    projectTitle: string;
    xp: number;
    balance: number;
    owner?: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
}

const CharacterXPBar = ({
  character,
  characterInfo,
}: {
  character: {
    id: number;
    projectId: number;
    projectTitle: string;
    xp: number;
    balance: number;
    owner?: boolean;
    createdAt: string;
    updatedAt: string;
  };
  characterInfo: CharacterInfo;
}) => {
  const level = characterInfo.getLevelByXp(character.xp);
  const maxXp = characterInfo.getMaxXpForLevel(level);
  const currentXp = characterInfo.getCurrentXpForLevel(level, character.xp);
  const percentage = Math.floor((currentXp * 100) / maxXp);
  const { l } = useI18n();

  return (
    <Flex direction="column" gap="xs">
      <Flex justify="space-between">
        <Text size="xs" c="dimmed" fw={500}>
          Experience Progress
        </Text>
        <Text size="xs" c="dimmed">
          {l(currentXp)} / {l(maxXp)} XP
        </Text>
      </Flex>

      <Progress
        value={percentage}
        size="md"
        radius="sm"
        color="blue"
        styles={{
          root: {
            backgroundColor: "var(--mantine-color-dark-6)",
          },
        }}
      />

      <Text size="xs" c="dimmed">
        Level {level} • {percentage}% to Level {level + 1}
      </Text>
    </Flex>
  );
};

const MyCharacters = (props: MyCharactersProps) => {
  const { characters } = props;
  const characterInfo = useInject(CharacterInfo);
  const { l } = useI18n();

  if (!characters || characters.length === 0) {
    return (
      <Flex
        bg={"var(--alepha-ground)"}
        flex={1}
        align="center"
        justify="center"
      >
        <Text c="dimmed" size="lg">
          No characters found. Join a project to create your first character!
        </Text>
      </Flex>
    );
  }

  return (
    <Flex bg={"var(--alepha-ground)"} flex={1} p="lg">
      <Flex direction="column" w="100%" maw={800}>
        <Flex gap="sm" align="center">
          <Title order={2}>My Characters</Title>
          <Badge variant="light">{characters.length}</Badge>
        </Flex>

        <Text c="dimmed" size="sm">
          Your active characters across all projects
        </Text>

        <Flex direction="column" gap="md">
          {characters.map((character) => {
            const level = characterInfo.getLevelByXp(character.xp);
            const gold = characterInfo.getGold(character.balance);
            const silver = characterInfo.getSilver(character.balance);

            return (
              <Card
                key={character.id}
                shadow="sm"
                padding="lg"
                radius="md"
                withBorder
              >
                <Flex direction="column" gap="md">
                  <Flex justify="space-between" align="flex-start">
                    <Flex direction="column" gap="xs">
                      <Flex gap="sm">
                        <Text fw={500} size="lg">
                          {character.projectTitle}
                        </Text>
                        {character.owner && (
                          <Badge
                            variant="light"
                            leftSection={<IconCrown size={12} />}
                          >
                            Owner
                          </Badge>
                        )}
                      </Flex>
                      <Text size="sm" c="dimmed">
                        Created{" "}
                        <Localize value={character.createdAt} date="fromNow" />
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
                              <IconCircleFilled
                                size={10}
                                color="var(--color-gold)"
                              />
                            </>
                          )}
                          {silver > 0 && (
                            <>
                              <Text size="sm" fw={500}>
                                {silver}
                              </Text>
                              <IconCircleFilled
                                size={10}
                                color="var(--color-silver)"
                              />
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

                  <CharacterXPBar
                    character={character}
                    characterInfo={characterInfo}
                  />
                </Flex>
              </Card>
            );
          })}
        </Flex>
      </Flex>
    </Flex>
  );
};

export default MyCharacters;
