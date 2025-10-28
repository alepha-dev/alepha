import { NestedView } from "@alepha/react";
import { AppShell } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
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
import { type MenuItem, Sidebar } from "../src/components/Sidebar";
import Header from "./components/Header";

const Layout = () => {
  const [opened, { toggle }] = useDisclosure();

  const menuItems: MenuItem[] = [
    {
      id: "examples",
      label: "Examples",
      icon: <IconCode size={18} />,
      children: [
        {
          id: "control",
          label: "Control",
          icon: <IconHome size={18} />,
          href: "/",
        },
        {
          id: "action",
          label: "Action",
          icon: <IconApi size={18} />,
          href: "/action",
        },
        {
          id: "typeform",
          label: "TypeForm",
          icon: <IconFileText size={18} />,
          href: "/typeform",
        },
        {
          id: "datatable",
          label: "DataTable",
          icon: <IconTable size={18} />,
          href: "/datatable",
        },
        {
          id: "dialog",
          label: "Dialog",
          icon: <IconMessage size={18} />,
          href: "/dialog",
        },
      ],
    },
    {
      id: "modules",
      label: "Modules",
      icon: <IconCode size={18} />,
      children: [
        {
          id: "core",
          label: "Core",
          icon: <IconServer size={18} />,
          children: [
            {
              id: "dependency-injection",
              label: "Dependency Injection",
            },
            {
              id: "hooks",
              label: "Hooks",
            },
            {
              id: "environment",
              label: "Environment",
            },
          ],
        },
        {
          id: "database",
          label: "Database",
          icon: <IconDatabase size={18} />,
          children: [
            {
              id: "entities",
              label: "Entities",
            },
            {
              id: "repositories",
              label: "Repositories",
            },
            {
              id: "migrations",
              label: "Migrations",
            },
          ],
        },
        {
          id: "api",
          label: "API",
          icon: <IconApi size={18} />,
          children: [
            {
              id: "actions",
              label: "Actions",
            },
            {
              id: "routes",
              label: "Routes",
            },
            {
              id: "middleware",
              label: "Middleware",
            },
          ],
        },
      ],
    },
    {
      id: "security",
      label: "Security",
      icon: <IconShield size={18} />,
      children: [
        {
          id: "authentication",
          label: "Authentication",
          icon: <IconUserCheck size={18} />,
          children: [
            {
              id: "oauth",
              label: "OAuth",
            },
            {
              id: "jwt",
              label: "JWT",
            },
            {
              id: "sessions",
              label: "Sessions",
            },
          ],
        },
        {
          id: "authorization",
          label: "Authorization",
          icon: <IconLock size={18} />,
        },
        {
          id: "realms",
          label: "Realms",
          icon: <IconKey size={18} />,
        },
      ],
    },
    {
      id: "infrastructure",
      label: "Infrastructure",
      icon: <IconCloud size={18} />,
      children: [
        {
          id: "notifications",
          label: "Notifications",
          icon: <IconNotification size={18} />,
        },
        {
          id: "email",
          label: "Email",
          icon: <IconMail size={18} />,
        },
      ],
    },
    {
      id: "docs",
      label: "Documentation",
      icon: <IconFileText size={18} />,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <IconSettings size={18} />,
    },
  ];

  return (
    <AppShell
      padding="md"
      header={{ height: 60 }}
      navbar={{
        width: 300,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
    >
      <AppShell.Header>
        <Header opened={opened} toggle={toggle} />
      </AppShell.Header>

      <AppShell.Navbar>
        <Sidebar
          menu={menuItems}
          defaultOpenIds={["examples"]}
          showSearchButton={true}
          onSearchClick={() => {
            console.log("Search button clicked - will open Omnibar");
            // TODO: Open Omnibar here
          }}
          onItemClick={(item) => {
            console.log("Clicked:", item.label);
          }}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <NestedView />
      </AppShell.Main>
    </AppShell>
  );
};

export default Layout;
