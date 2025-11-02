import { Flex, type FlexProps } from "@mantine/core";
import type { ReactNode } from "react";
import { DarkModeButton, OmnibarButton } from "../../index.ts";
import BurgerButton from "../buttons/BurgerButton.tsx";

export type AppBarItem = {
  position: "left" | "center" | "right";
  element: ReactNode;
};

export interface AppBarProps {
  flexProps?: FlexProps;
}

const AppBar = (props: AppBarProps) => {
  return (
    <Flex
      h="100%"
      align="center"
      px="md"
      justify="space-between"
      {...props.flexProps}
    >
      <Flex flex={1}>
        <BurgerButton />
      </Flex>
      <Flex>
        <OmnibarButton />
      </Flex>
      <Flex flex={1} gap="md" align={"center"} justify={"end"}>
        <DarkModeButton mode={"segmented"} />
      </Flex>
    </Flex>
  );
};

export default AppBar;
