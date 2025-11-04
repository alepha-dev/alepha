import { ActionButton, DarkModeButton, OmnibarButton } from "@alepha/ui";
import BurgerButton from "@alepha/ui/src/components/buttons/BurgerButton";
import { Flex, Text } from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";

const Header = () => {
  return (
    <Flex flex={1} px="lg" align={"center"}>
      <Flex flex={1}>
        <BurgerButton />
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
