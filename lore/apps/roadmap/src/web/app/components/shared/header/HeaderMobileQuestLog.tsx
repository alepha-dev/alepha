import { Flex } from "@alepha/mantine";
import { Burger, Drawer } from "@mantine/core";
import { useEvents, useStore } from "alepha/react";
import { useState } from "react";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { theme } from "../../../constants/theme.ts";
import QuestLog from "../../project/QuestLog.tsx";

const HeaderMobileQuestLog = () => {
  const [show, setShow] = useState(false);
  const [project] = useStore(currentProjectAtom);

  useEvents(
    {
      "react:transition:end": () => setShow(false),
    },
    [],
  );

  if (!project) {
    return null;
  }

  return (
    <Flex hiddenFrom={"lg"}>
      <Burger opened={show} onClick={() => setShow(true)} />
      <Drawer
        flex={1}
        bg={theme.colors.panel}
        onClose={() => setShow(false)}
        position={"left"}
        opened={show}
        style={{
          borderRight: "1px solid var(--mantine-color-dark-4)",
        }}
      >
        <QuestLog />
      </Drawer>
    </Flex>
  );
};

export default HeaderMobileQuestLog;
