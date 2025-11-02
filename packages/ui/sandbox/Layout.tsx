import { useRouter } from "@alepha/react";
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
import AdminShell from "../src/components/layout/AdminShell.tsx";

const Layout = () => {
  const router = useRouter();
  return (
    <AdminShell
      // appShellProps={{
      //   withBorder: false,
      // }}
      // appShellNavbarProps={{
      //   bg: ui.colors.background,
      // }}
      // appShellHeaderProps={{
      //   bg: `linear-gradient(to bottom, ${ui.colors.background}, ${ui.colors.background} 60%, ${ui.colors.transparent})`,
      //   style: {
      //     // backdropFilter: "blur(2px)",
      //   },
      // }}
      menu={[
        {
          type: "search",
          position: "top",
        },
        {
          type: "spacer",
          position: "top",
        },
        {
          label: "Examples",
          icon: <IconCode size={18} />,
          children: [
            {
              label: "Control",
              icon: <IconHome size={18} />,
              href: "/",
            },
            {
              label: "TypeForm",
              icon: <IconFileText size={18} />,
              href: "/typeform",
            },
            {
              label: "DataTable",
              icon: <IconTable size={18} />,
              href: "/datatable",
            },
            {
              label: "Dialog",
              icon: <IconMessage size={18} />,
              href: "/dialog",
            },
          ],
        },
        {
          label: "Modules",
          icon: <IconCode size={18} />,
          children: [
            {
              label: "Core",
              icon: <IconServer size={18} />,
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
              icon: <IconDatabase size={18} />,
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
              icon: <IconApi size={18} />,
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
          icon: <IconShield size={18} />,
          children: [
            {
              label: "Authentication",
              icon: <IconUserCheck size={18} />,
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
              icon: <IconLock size={18} />,
            },
            {
              label: "Realms",
              icon: <IconKey size={18} />,
            },
          ],
        },
        {
          label: "Infrastructure",
          icon: <IconCloud size={18} />,
          children: [
            {
              label: "Notifications",
              icon: <IconNotification size={18} />,
            },
            {
              label: "Email",
              icon: <IconMail size={18} />,
            },
          ],
        },
        {
          type: "spacer",
        },
        {
          label: "Documentation",
          icon: <IconFileText size={18} />,
        },
        {
          type: "divider",
          position: "bottom",
        },
        {
          position: "bottom",
          label: "Settings",
          description: "Configure your preferences",
          icon: <IconSettings size={18} />,
          actionProps: {
            py: "lg",
          },
        },
      ]}
    ></AdminShell>
  );
};

export default Layout;
