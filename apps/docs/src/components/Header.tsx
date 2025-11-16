import {
  ActionButton,
  BurgerButton,
  DarkModeButton,
  OmnibarButton,
} from "@alepha/ui";
import { Flex, Text } from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";

export interface HeaderProps {
  noSidebar?: boolean;
}

const Header = (props: HeaderProps) => {
  return (
    <Flex flex={1} px="lg" align={"center"}>
      <Flex align={"center"} flex={1}>
        {props.noSidebar ? null : <BurgerButton />}
        <HomeButton />
      </Flex>
      <Flex>
        <OmnibarButton />
      </Flex>
      <Flex flex={1} justify={"end"} gap={"md"}>
        <ActionButton
          variant={"outline"}
          href={"https://github.com/feunard/alepha"}
          target={"_blank"}
          icon={<IconBrandGithub />}
        />
        <DarkModeButton mode="segmented" />
      </Flex>
    </Flex>
  );
};

export default Header;

const HomeButton = () => {
  return (
    <ActionButton size={"xl"} variant={"transparent"} href={"/"} active={false}>
      <Flex direction={"column"} align={"center"}>
        <Text size={"xl"}>Alepha</Text>
      </Flex>
    </ActionButton>
  );
};
