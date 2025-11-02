import { useStore } from "@alepha/react";
import { Burger, Flex, type FlexProps } from "@mantine/core";
import { DarkModeButton } from "../../src";
import LanguageButton from "../../src/components/buttons/LanguageButton.tsx";

export interface HeaderProps {
  flexProps?: FlexProps;
}

const Header = (props: HeaderProps) => {
  const [opened, setOpened] = useStore("alepha.ui.sidebar.opened");

  return (
    <Flex
      h="100%"
      align="center"
      px="md"
      justify="space-between"
      {...props.flexProps}
    >
      <Flex>
        <Burger
          opened={opened}
          onClick={() => setOpened(!opened)}
          hiddenFrom="sm"
          size="sm"
        />
      </Flex>
      <Flex gap="md" align={"center"} justify={"center"}>
        <LanguageButton />
        <DarkModeButton mode="segmented" />
      </Flex>
    </Flex>
  );
};

export default Header;
