import { Flex, Kbd, Text } from "@mantine/core";
import { useOs } from "@mantine/hooks";
import { spotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import { ClientOnly } from "alepha/react";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

export interface OmnibarButtonProps {
  actionProps?: ActionProps;
  collapsed?: boolean;
}

const OmnibarButton = (props: OmnibarButtonProps) => {
  const os = useOs();
  const isMac = os === "macos" || os === "ios";
  const shortcut = isMac ? "⌘" : "Ctrl";

  return (
    <ActionButton
      variant={"default"}
      onClick={spotlight.open}
      justify={"space-between"}
      rightSection={
        <Kbd visibleFrom={"sm"} size={"sm"}>
          <ClientOnly>{shortcut}</ClientOnly>+K
        </Kbd>
      }
      radius={"md"}
      {...props.actionProps}
    >
      <Flex align={"center"} gap={"xs"}>
        <IconSearch size={16} color={"gray"} />
        <Flex visibleFrom={"sm"} miw={192}>
          <Text size={"xs"} c={"dimmed"}>
            Search...
          </Text>
        </Flex>
      </Flex>
    </ActionButton>
  );
};

export default OmnibarButton;
