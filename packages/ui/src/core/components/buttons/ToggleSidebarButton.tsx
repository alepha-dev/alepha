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
        sidebar.collapsed
          ? IconLayoutSidebarRightCollapse
          : IconLayoutSidebarLeftCollapse
      }
      visibleFrom={"md"}
      variant={"default"}
      onClick={() => {
        setSidebar({
          ...sidebar,
          collapsed: !sidebar.collapsed,
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
