import { Flex, Text } from "@alepha/ui";
import { Card, HoverCard } from "@mantine/core";
import { useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { currentProjectCharacterAtom } from "../../atoms/currentProjectCharacterAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import LevelUpAnimation from "./LevelUpAnimation.tsx";

const ExperienceBar = () => {
  const auth = useAuth();
  const { tr } = useI18n<I18n, "en">();
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
  const percentage = max > 0 ? Math.floor((current * 100) / max) : 100;

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
                <Flex direction="column" style={{ maxWidth: 256 }}>
                  <Text>{tr("xp.bar.title")}</Text>
                  <Text size="sm">{tr("xp.bar.description")}</Text>
                </Flex>
              </HoverCard.Dropdown>
            </HoverCard>
          </Flex>
        </Flex>
      </Flex>
    </>
  );
};

export default ExperienceBar;
