import { Flex } from "@mantine/core";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarRightCollapse,
} from "@tabler/icons-react";
import { useStore } from "alepha/react";
import ActionButton from "./ActionButton.tsx";

const ToggleSidebarButton = () => {
  const [collapsed, setCollapsed] = useStore("alepha.ui.sidebar.collapsed");

  return (
    <Flex>
      <ActionButton
        icon={
          collapsed ? (
            <IconLayoutSidebarRightCollapse />
          ) : (
            <IconLayoutSidebarLeftCollapse />
          )
        }
        variant={"subtle"}
        size={"md"}
        onClick={() => setCollapsed(!collapsed)}
        tooltip={{
          position: "right",
          label: collapsed ? "Show sidebar" : "Hide sidebar",
        }}
      />
    </Flex>
  );
};

export default ToggleSidebarButton;
