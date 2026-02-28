import { Flex, Text } from "@alepha/ui";
import { Progress } from "@mantine/core";
import { useI18n } from "alepha/react/i18n";
import type { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { MyCharactersCharacter } from "./MyCharacters.tsx";

export interface MyCharactersXPBarProps {
  character: MyCharactersCharacter;
  characterInfo: CharacterInfo;
}

const MyCharactersXPBar = (props: MyCharactersXPBarProps) => {
  const { character, characterInfo } = props;
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

export default MyCharactersXPBar;
