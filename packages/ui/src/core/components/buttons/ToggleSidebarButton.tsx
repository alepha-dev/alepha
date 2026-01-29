import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarRightCollapse,
} from "@tabler/icons-react";
import { useStore } from "alepha/react";
import { alephaSidebarAtom } from "../../atoms/alephaSidebarAtom.ts";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

type Props = ActionProps;

const ToggleSidebarButton = (props: Props) => {
  const [sidebar, setSidebar] = useStore(alephaSidebarAtom);

  return (
    <ActionButton
      icon={
        sidebar.collapsed ? (
          <IconLayoutSidebarRightCollapse />
        ) : (
          <IconLayoutSidebarLeftCollapse />
        )
      }
      visibleFrom={"sm"}
      variant={"subtle"}
      size={"md"}
      onClick={() => {
        const expanding = sidebar.collapsed;
        setSidebar({
          ...sidebar,
          collapsed: !sidebar.collapsed,
          // Reset width to defaultWidth when expanding
          width: expanding ? sidebar.defaultWidth : sidebar.width,
        });
      }}
      tooltip={{
        position: "right",
        label: sidebar.collapsed ? "Show sidebar" : "Hide sidebar",
      }}
      {...props}
    />
  );
};

export default ToggleSidebarButton;
