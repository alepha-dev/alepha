import { Flex, Kbd, Text } from "@mantine/core";
import { spotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

export interface OmnibarButtonProps {
  actionProps?: ActionProps;
  collapsed?: boolean;
}

const OmnibarButton = (props: OmnibarButtonProps) => {
  return (
    <ActionButton
      variant={"default"}
      miw={256}
      onClick={spotlight.open}
      justify={"space-between"}
      rightSection={<Kbd size={"sm"}>⌘+K</Kbd>}
      radius={"md"}
      {...props.actionProps}
    >
      <Flex align={"center"} gap={"xs"}>
        <IconSearch size={16} color={"gray"} />
        <Text size={"xs"} c={"dimmed"}>
          Search...
        </Text>
      </Flex>
    </ActionButton>
  );
};

export default OmnibarButton;
