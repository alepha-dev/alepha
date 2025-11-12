import { useInject, useStore } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Card, Flex, HoverCard, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { currentProjectCharacterAtom } from "../../atoms/currentProjectCharacterAtom.ts";
import { theme } from "../../constants/theme.ts";
import { CharacterInfo } from "../../services/CharacterInfo.ts";
import LevelUpAnimation from "./LevelUpAnimation.jsx";

const ExperienceBar = () => {
  const auth = useAuth();
  const [character] = useStore(currentProjectCharacterAtom);
  const info = useInject(CharacterInfo);

  if (!auth.user || !character) {
    return null;
  }

  const chunks: Array<ReactNode> = [];

  for (let i = 0; i < 20; i++) {
    chunks.push(
      <Card
        bg={"transparent"}
        withBorder
        radius={0}
        p={0}
        key={i}
        className={`experience-bar-chunk n${i}`}
      />,
    );
  }

  const level = info.getLevelByXp(character.xp);
  const max = info.getMaxXpForLevel(level);
  const current = info.getCurrentXpForLevel(level, character.xp);
  const percentage = Math.floor((current * 100) / max);

  return (
    <>
      <LevelUpAnimation />
      <Flex p={"xs"}>
        <Flex
          flex={1}
          style={{
            position: "relative",
          }}
        >
          <Card
            p={0}
            bg={theme.colors.panel}
            style={{ width: "100%", height: 10 }}
          />

          <Flex
            className={"experience-bar-progress"}
            style={{ width: `${percentage}%` }}
          />

          <Flex w={"100%"} style={{ position: "absolute", height: "100%" }}>
            {chunks}
          </Flex>

          <Card
            withBorder
            p={0}
            className={"experience-bar-cursor"}
            style={{ left: `${percentage}%` }}
          />

          <Flex
            flex={1}
            align="center"
            justify="center"
            style={{ position: "absolute", left: 0, top: -4, right: 0 }}
          >
            <HoverCard openDelay={1000} position="top">
              <HoverCard.Target>
                <Text size={"xs"} className={"experience-bar-text"}>
                  XP: {current}/{max}
                </Text>
              </HoverCard.Target>
              <HoverCard.Dropdown>
                <Stack style={{ maxWidth: 256 }}>
                  <Text>Experience Bar</Text>
                  <Text size="sm">
                    Shows your current experience progress towards the next
                    level.
                  </Text>
                </Stack>
              </HoverCard.Dropdown>
            </HoverCard>
          </Flex>
        </Flex>
      </Flex>
    </>
  );
};

export default ExperienceBar;
