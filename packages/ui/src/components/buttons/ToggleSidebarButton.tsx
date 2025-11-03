import { useStore } from "@alepha/react";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarRightCollapse,
} from "@tabler/icons-react";
import ActionButton from "./ActionButton.tsx";

const ToggleSidebarButton = () => {
  const [collapsed, setCollapsed] = useStore("alepha.ui.sidebar.collapsed");

  return (
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
      tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    />
  );
};

export default ToggleSidebarButton;
