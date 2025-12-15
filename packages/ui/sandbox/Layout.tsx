import { Badge } from "@mantine/core";
import {
  IconApi,
  IconCloud,
  IconCode,
  IconDatabase,
  IconFileText,
  IconHome,
  IconKey,
  IconLock,
  IconMail,
  IconMessage,
  IconNotification,
  IconServer,
  IconSettings,
  IconShield,
  IconTable,
  IconUserCheck,
} from "@tabler/icons-react";
import ToggleSidebarButton from "../src/core/components/buttons/ToggleSidebarButton.tsx";
import AdminShell from "../src/core/components/layout/AdminShell.tsx";
import { ui } from "../src/core/constants/ui.ts";

const Layout = () => {
  return (
    <AdminShell
      appShellProps={{
        bg: ui.colors.surface,
      }}
      appShellNavbarProps={{}}
      appShellHeaderProps={{
        bg: ui.colors.transparent,
      }}
      appBarProps={{
        flexProps: {
          bg: ui.colors.transparent,
          style: {
            backdropFilter: "blur(20px)",
          },
        },
        items: [
          { type: "burger", position: "left" },
          { type: "spacer", position: "left" },
          { type: "dark", position: "right" },
        ],
      }}
      sidebarProps={{
        menu: [
          {
            element: <ToggleSidebarButton />,
          },
          {
            type: "spacer",
          },
          {
            label: "Examples",
            icon: <IconCode />,
            children: [
              {
                label: "Control",
                icon: <IconHome />,
                href: "/",
              },
              {
                label: "TypeForm",
                icon: <IconFileText />,
                href: "/typeform",
              },
              {
                label: "TypeForm2",
                icon: <IconFileText />,
                href: "/typeform2",
              },
              {
                label: "DataTable",
                icon: <IconTable />,
                href: "/datatable",
              },
              {
                label: "Dialog",
                icon: <IconMessage />,
                href: "/dialog",
              },
            ],
          },
          {
            label: "Modules",
            icon: <IconCode />,
            children: [
              {
                label: "Core",
                icon: <IconServer />,
                children: [
                  {
                    label: "Dependency Injection",
                  },
                  {
                    label: "Hooks",
                  },
                  {
                    label: "Environment",
                  },
                ],
              },
              {
                label: "Database",
                icon: <IconDatabase />,
                children: [
                  {
                    label: "Entities",
                    rightSection: <Badge color={"blue"}>New</Badge>,
                  },
                  {
                    label: "Repositories",
                  },
                  {
                    label: "Action",
                    href: "/action",
                  },
                  {
                    label: "Migrations",
                  },
                ],
              },
              {
                label: "API",
                icon: <IconApi />,
                children: [
                  {
                    label: "Actions",
                  },
                  {
                    label: "Routes",
                  },
                  {
                    label: "Middleware",
                  },
                ],
              },
            ],
          },
          {
            type: "section",
            label: "Capabilities",
          },
          {
            label: "Security",
            icon: <IconShield />,
            children: [
              {
                label: "Authentication",
                icon: <IconUserCheck />,
                children: [
                  {
                    label: "OAuth",
                  },
                  {
                    label: "JWT",
                  },
                  {
                    label: "Sessions",
                  },
                ],
              },
              {
                label: "Authorization",
                icon: <IconLock />,
              },
              {
                label: "Realms",
                icon: <IconKey />,
              },
            ],
          },
          {
            label: "Infrastructure",
            icon: <IconCloud />,
            children: [
              {
                label: "Notifications",
                icon: <IconNotification />,
              },
              {
                label: "Email",
                icon: <IconMail />,
              },
            ],
          },
          {
            type: "spacer",
          },
          {
            label: "Documentation",
            icon: <IconFileText />,
          },
          {
            type: "divider",
            position: "bottom",
          },
          {
            label: "Settings",
            icon: <IconSettings />,
            position: "bottom",
          },
        ],
      }}
    />
  );
};

export default Layout;
