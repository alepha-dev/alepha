import { Spotlight, type SpotlightActionData } from "@mantine/spotlight";
import {
  IconDashboard,
  IconFileText,
  IconHome,
  IconSearch,
  IconSettings,
  IconUser,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface OmnibarProps {
  actions?: SpotlightActionData[];
  shortcut?: string | string[];
  searchPlaceholder?: string;
  nothingFound?: ReactNode;
}

const defaultActions: SpotlightActionData[] = [
  {
    id: "home",
    label: "Home",
    description: "Go to home page",
    onClick: () => console.log("Home"),
    leftSection: <IconHome size={20} />,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "View your dashboard",
    onClick: () => console.log("Dashboard"),
    leftSection: <IconDashboard size={20} />,
  },
  {
    id: "documents",
    label: "Documents",
    description: "Browse all documents",
    onClick: () => console.log("Documents"),
    leftSection: <IconFileText size={20} />,
  },
  {
    id: "profile",
    label: "Profile",
    description: "View and edit your profile",
    onClick: () => console.log("Profile"),
    leftSection: <IconUser size={20} />,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Manage application settings",
    onClick: () => console.log("Settings"),
    leftSection: <IconSettings size={20} />,
  },
];

const Omnibar = (props: OmnibarProps) => {
  const actions = props.actions ?? defaultActions;
  const shortcut = props.shortcut ?? "mod+K";
  const searchPlaceholder = props.searchPlaceholder ?? "Search...";
  const nothingFound = props.nothingFound ?? "Nothing found...";

  return (
    <Spotlight
      actions={actions}
      shortcut={shortcut}
      searchProps={{
        leftSection: <IconSearch size={20} />,
        placeholder: searchPlaceholder,
      }}
      nothingFound={nothingFound}
    />
  );
};

export default Omnibar;
