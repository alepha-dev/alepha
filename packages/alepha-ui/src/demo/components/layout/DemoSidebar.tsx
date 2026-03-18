import { Sidebar, type SidebarNode } from "@alepha/ui";
import { Flex } from "@mantine/core";
import {
  IconDashboard,
  IconFiles,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const sidebarItems = [
  { type: "search" },
  { type: "divider" },
  {
    icon: IconDashboard,
    label: "Dashboard",
  },
  {
    icon: IconUsers,
    label: "Users",
    children: [
      { label: "All Users" },
      { label: "Add User" },
      { label: "Roles" },
    ],
  },
  {
    icon: IconFiles,
    label: "Files",
  },
  { type: "spacer" },
  {
    position: "bottom",
    icon: IconSettings,
    label: "Settings",
  },
] satisfies SidebarNode[];

const showcaseSchema = t.object({
  collapsed: t.boolean({
    title: "Collapsed",
    default: false,
    $control: { switch: true },
  }),
  gap: t.enum(["xs", "sm", "md", "lg"], {
    title: "Gap",
    default: "xs",
    $control: { segmented: true },
  }),
});

const DemoSidebar = () => {
  return (
    <Showcase
      title="Sidebar"
      schema={showcaseSchema}
      initialValues={{
        collapsed: false,
        gap: "xs",
      }}
      columns={1}
      windowProps={{
        containerProps: { p: 0 },
      }}
    >
      {(props) => (
        <Flex
          h={"100%"}
          w={props.collapsed ? 60 : 240}
          bg="var(--alepha-surface)"
        >
          <Sidebar
            items={sidebarItems}
            collapsed={props.collapsed}
            gap={props.gap}
          />
        </Flex>
      )}
    </Showcase>
  );
};

export default DemoSidebar;
